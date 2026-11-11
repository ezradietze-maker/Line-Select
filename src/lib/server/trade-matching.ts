import { bidMonthEnd } from "@/lib/bid-month";
import { reportProblem } from "@/lib/server/alerts";
import { bidPackRecordWithFingerprint, getBidPackRecord, getTradeHolding, setHoldingFingerprint } from "@/lib/server/db";
import { incrementCounter, setJson } from "@/lib/server/kv";
import { tradeBoardIsOpen } from "@/lib/server/trade-board-bar";
import { emailNewTrade } from "@/lib/server/trade-email";
import { accountPackFingerprint, groupFingerprint, unpackRecord } from "@/lib/server/trade-pack";
import { lapseUnanswered, listActiveGroups, listMatchingGroup, matchingHistory, refusedTripKey, saveSuggestion, swapKey, tradeDayCounts } from "@/lib/server/trade-suggestions";
import { pilotsForMatching } from "@/lib/trades/holding";
import { findTrades } from "@/lib/trades/match";
import { suggestionToStore, tradeSignature } from "@/lib/trades/suggestions";
import type { Seat } from "@/types/bidpack";
import type { BidPackMetaSnapshot, TradeDeclineReason } from "@/types/trade";

/**
 * Works out trades for a base, aircraft, seat and month, stores what's new, and tells those who asked to be emailed. Costs
 * server time only: no AI and no paid lookups. One at a time per group, so two runs can't put the same pilot on two trades.
 */

const RUN_SECONDS = 90;
/** A trade takes two. */
const MIN_PILOTS = 2;
/** The whole daily run's limit, leaving the morning email time to go within the cron's five minutes. */
const DAILY_BUDGET_MS = 120_000;
/** How long one group's search may take, inside Find trades' 90 seconds with time to store and email what it found. */
const SEARCH_MS = 45_000;

export type MatchingOutcome =
  | { status: "ran"; found: number; pilots: number }
  | { status: "busy" }
  /** They haven't confirmed what they hold, or the pack on their account isn't this one. */
  | { status: "not-ready" }
  /** Their seat's Trade Board hasn't opened (`trade-board-bar.ts`), or its month is over. */
  | { status: "closed" }
  /** What they hold was confirmed on a pack that isn't the one most of their seat confirmed on. */
  | { status: "pack-differs" };

async function matchGroup(meta: BidPackMetaSnapshot, now: number, deadline = Date.now() + SEARCH_MS, caller: string | null = null): Promise<MatchingOutcome> {
  const lockKey = `line-select:trade-matching:${meta.base}:${meta.aircraft}:${meta.seat}:${meta.month}`;
  if ((await incrementCounter(lockKey, RUN_SECONDS)) > 1) return { status: "busy" };
  try {
    // When the group was read: anything a pilot changed after it means what was found from it may not stand.
    const foundFrom = new Date();
    await lapseUnanswered(meta, new Date(now));
    const [{ rows, names, fingerprints }, history] = await Promise.all([listMatchingGroup(meta), matchingHistory(meta, new Date(now))]);
    // A holding confirmed before fingerprints were kept: from the pack on the pilot's account, while it's still this one.
    for (const r of rows) {
      if (!r.holding || fingerprints.get(r.userId)) continue;
      const fingerprint = await accountPackFingerprint(r.userId, r.holding.packId);
      if (!fingerprint) continue;
      fingerprints.set(r.userId, fingerprint);
      await setHoldingFingerprint(r.userId, r.holding.packId, fingerprint);
    }
    const fingerprint = groupFingerprint(rows.flatMap((r) => (r.holding ? [{ fingerprint: fingerprints.get(r.userId) ?? null, confirmedAt: r.holding.confirmedAt }] : [])));
    if (!fingerprint) return { status: "not-ready" };
    if (caller && fingerprints.get(caller) !== fingerprint) return { status: "pack-differs" };
    // Matched on that pack, from any account holding it, and only with what was confirmed on it.
    const onIt = rows.filter((r) => fingerprints.get(r.userId) === fingerprint);
    const record = await bidPackRecordWithFingerprint(onIt.map((r) => r.userId), fingerprint);
    if (!record) return { status: "not-ready" };
    const pack = unpackRecord(record.data);
    const end = bidMonthEnd(pack);
    if (end !== null && end <= now) return { status: "closed" };
    const everyone = pilotsForMatching(pack, onIt);
    const confirmedAt = new Map(onIt.map((r) => [r.userId, r.holding?.confirmedAt ?? ""]));
    const doubted = (pilotId: string) => {
      const said = history.holdingDoubted.get(pilotId);
      return !!said && !(Date.parse(confirmedAt.get(pilotId) ?? "") > said.getTime());
    };
    const available = everyone.filter((p) => !history.busyPilots.has(p.pilotId) && !doubted(p.pilotId));
    const { trades } = findTrades(pack, available, {
      now,
      excludeSwap: (pilotId, give, take) => history.declined.has(swapKey(pilotId, give, take)) || history.refusedTrips.has(refusedTripKey(pilotId, take)),
      minGainFor: (pilotId) => history.minGains.get(pilotId),
      deadline,
    });
    const fresh = trades.filter((t) => !history.signatures.has(tradeSignature(pack.id, t.legs.map((l) => ({ pilotId: l.pilotId, give: l.value.give })))));
    let found = 0;
    for (const t of fresh) {
      const stored = suggestionToStore(pack, t, names);
      if (await saveSuggestion(stored, foundFrom)) {
        found++;
        await emailNewTrade(stored, new Date(now));
      }
    }
    return { status: "ran", found, pilots: everyone.length };
  } finally {
    await setJson(lockKey, 0, { ttlSeconds: 1 });
  }
}

const seatOf = (meta: BidPackMetaSnapshot) => ({ base: meta.base, aircraft: meta.aircraft, seat: meta.seat as Seat });

/** A pilot pressing Find trades. */
export async function runMatching(userId: string, packId: string, now = Date.now()): Promise<MatchingOutcome> {
  const [holding, record] = await Promise.all([getTradeHolding(userId, packId), getBidPackRecord(userId)]);
  if (!holding || !record || record.packId !== packId) return { status: "not-ready" };
  if (!(await tradeBoardIsOpen(seatOf(holding.bidPackMeta), new Date(now)))) return { status: "closed" };
  return matchGroup(holding.bidPackMeta, now, Date.now() + SEARCH_MS, userId);
}

export interface DailyMatchingResult {
  groups: number;
  /** Seats whose board hasn't opened, months over, or with no pack on anyone's account. */
  skipped: number;
  found: number;
  failed: number;
  /** Out of time with this many left: tomorrow's run reaches them. */
  notReached: number;
}

/** The daily run: every month and seat with pilots to match, within a time limit. Never throws: one seat failing can't stop the rest or the morning email. */
export async function runDailyMatching(nowDate = new Date(), budgetMs = DAILY_BUDGET_MS): Promise<DailyMatchingResult> {
  const result: DailyMatchingResult = { groups: 0, skipped: 0, found: 0, failed: 0, notReached: 0 };
  const now = nowDate.getTime();
  const started = Date.now();
  let groups: BidPackMetaSnapshot[];
  try {
    groups = await listActiveGroups(MIN_PILOTS);
  } catch (e) {
    await reportProblem("trades", e, { action: "daily matching" });
    result.failed++;
    return result;
  }
  result.groups = groups.length;
  for (const [i, meta] of groups.entries()) {
    if (Date.now() - started > budgetMs) {
      result.notReached = groups.length - i;
      break;
    }
    try {
      if (!(await tradeBoardIsOpen(seatOf(meta), nowDate))) {
        result.skipped++;
        continue;
      }
      // Within what's left of the day's budget too: a big group starting late can't run past the cron's limit.
      const outcome = await matchGroup(meta, now, Date.now() + Math.min(SEARCH_MS, Math.max(5_000, budgetMs - (Date.now() - started))));
      if (outcome.status === "ran") result.found += outcome.found;
      else result.skipped++;
    } catch (e) {
      await reportProblem("trades", e, { action: "daily matching" });
      result.failed++;
    }
  }
  return result;
}

const REASON_LABELS: Record<TradeDeclineReason, string> = {
  trip: "didn't want the trip",
  notWorthIt: "not worth the trouble",
  notNow: "not right now",
  wrongHolding: "not what they hold",
};

/** The trades part of the owner's daily email: what today's run did, and how yesterday's suggestions were answered. Null while there's nothing to say. */
export async function tradeSummaryText(run: DailyMatchingResult, now = new Date()): Promise<string | null> {
  try {
    const counts = await tradeDayCounts(new Date(now.getTime() - 24 * 3_600_000), now);
    const suggested = Object.entries(counts.suggested);
    if (run.groups === 0 && suggested.length === 0 && counts.yes + counts.no === 0) return null;
    const reasons = (Object.entries(counts.noBecause) as [TradeDeclineReason, number][]).map(([k, n]) => `${REASON_LABELS[k]}: ${n}`);
    return [
      "Trade matching",
      `This morning: ${run.groups} seat${run.groups === 1 ? "" : "s"} with pilots to match, ${run.skipped} skipped, ${run.found} new trade${run.found === 1 ? "" : "s"}${run.failed ? `, ${run.failed} FAILED` : ""}${run.notReached ? `, ${run.notReached} not reached in time` : ""}.`,
      `Last 24 hours: ${suggested.length ? suggested.map(([size, n]) => `${n} of ${size} pilots`).join(", ") : "none"} suggested, ${counts.yes} yes, ${counts.no} no${reasons.length ? ` (${reasons.join(", ")})` : ""}, ${counts.finished} finished, ${counts.lapsed} lapsed.`,
    ].join("\n");
  } catch (e) {
    console.error("[trades] summary not made", e);
    return null;
  }
}
