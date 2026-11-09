import { gunzipSync } from "node:zlib";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { bidMonthEnd } from "@/lib/bid-month";
import { reportProblem } from "@/lib/server/alerts";
import { getBidPackRecord, getTradeHolding } from "@/lib/server/db";
import { incrementCounter, setJson } from "@/lib/server/kv";
import { tradeBoardIsOpen } from "@/lib/server/trade-board-bar";
import { emailNewTrade } from "@/lib/server/trade-email";
import { listActiveGroups, listMatchingGroup, matchingHistory, refusedTripKey, saveSuggestion, swapKey, tradeDayCounts } from "@/lib/server/trade-suggestions";
import { isPackId } from "@/lib/pack-id";
import { pilotsForMatching } from "@/lib/trades/holding";
import { findTrades } from "@/lib/trades/match";
import { suggestionToStore, tradeSignature } from "@/lib/trades/suggestions";
import type { BidPack, Seat } from "@/types/bidpack";
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

export type MatchingOutcome =
  | { status: "ran"; found: number; pilots: number }
  | { status: "busy" }
  /** They haven't confirmed what they hold, or the pack on their account isn't this one. */
  | { status: "not-ready" }
  /** Their seat's Trade Board hasn't opened (`trade-board-bar.ts`). */
  | { status: "closed" };

async function matchGroup(pack: BidPack, meta: BidPackMetaSnapshot, now: number): Promise<MatchingOutcome> {
  const lockKey = `line-select:trade-matching:${meta.base}:${meta.aircraft}:${meta.seat}:${meta.month}`;
  if ((await incrementCounter(lockKey, RUN_SECONDS)) > 1) return { status: "busy" };
  try {
    const [{ rows, names }, history] = await Promise.all([listMatchingGroup(meta), matchingHistory(meta, new Date(now))]);
    const everyone = pilotsForMatching(pack, rows);
    const available = everyone.filter((p) => !history.busyPilots.has(p.pilotId));
    const { trades } = findTrades(pack, available, {
      now,
      excludeSwap: (pilotId, give, take) => history.declined.has(swapKey(pilotId, give, take)) || history.refusedTrips.has(refusedTripKey(pilotId, take)),
      minGainFor: (pilotId) => history.minGains.get(pilotId),
    });
    const fresh = trades.filter((t) => !history.signatures.has(tradeSignature(pack.id, t.legs.map((l) => ({ pilotId: l.pilotId, give: l.value.give })))));
    let found = 0;
    for (const t of fresh) {
      const stored = suggestionToStore(pack, t, names);
      if (await saveSuggestion(stored)) {
        found++;
        await emailNewTrade(stored, new Date(now));
      }
    }
    return { status: "ran", found, pilots: everyone.length };
  } finally {
    await setJson(lockKey, 0, { ttlSeconds: 1 });
  }
}

const unpack = (data: Buffer): BidPack => restoreBidPack(JSON.parse(gunzipSync(data).toString("utf8")));
const seatOf = (meta: BidPackMetaSnapshot) => ({ base: meta.base, aircraft: meta.aircraft, seat: meta.seat as Seat });

/** A pilot pressing Find trades. */
export async function runMatching(userId: string, packId: string, now = Date.now()): Promise<MatchingOutcome> {
  const [holding, record] = await Promise.all([getTradeHolding(userId, packId), getBidPackRecord(userId)]);
  if (!holding || !record || record.packId !== packId) return { status: "not-ready" };
  if (!(await tradeBoardIsOpen(seatOf(holding.bidPackMeta), new Date(now)))) return { status: "closed" };
  return matchGroup(unpack(record.data), holding.bidPackMeta, now);
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
      const pack = await packForGroup(meta);
      const end = pack ? bidMonthEnd(pack) : null;
      if (!pack || (end !== null && end <= now)) {
        result.skipped++;
        continue;
      }
      const outcome = await matchGroup(pack, meta, now);
      if (outcome.status === "ran") result.found += outcome.found;
      else result.skipped++;
    } catch (e) {
      await reportProblem("trades", e, { action: "daily matching" });
      result.failed++;
    }
  }
  return result;
}

/** The group's bid pack, from the account of any pilot in it who still has it. */
async function packForGroup(meta: BidPackMetaSnapshot): Promise<BidPack | null> {
  const { rows } = await listMatchingGroup(meta);
  for (const r of rows) {
    const record = await getBidPackRecord(r.userId);
    if (!record) continue;
    const pack = unpack(record.data);
    if (isPackId(r.holding?.packId, pack)) return pack;
  }
  return null;
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
