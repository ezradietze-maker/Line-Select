import { gunzipSync } from "node:zlib";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { getBidPackRecord, getTradeHolding } from "@/lib/server/db";
import { incrementCounter, setJson } from "@/lib/server/kv";
import { listMatchingGroup, matchingHistory, saveSuggestion, swapKey } from "@/lib/server/trade-suggestions";
import { pilotsForMatching } from "@/lib/trades/holding";
import { findTrades } from "@/lib/trades/match";
import { suggestionToStore, tradeSignature } from "@/lib/trades/suggestions";
import type { BidPack } from "@/types/bidpack";

/**
 * Works out trades for a pilot's base, aircraft, seat and month, and stores what's new. Costs server time only: no AI and
 * no paid lookups. One at a time per group, so two pilots pressing at once can't put the same pilot on two trades.
 */

const RUN_SECONDS = 90;

export type MatchingOutcome =
  | { status: "ran"; found: number; pilots: number }
  | { status: "busy" }
  /** They haven't confirmed what they hold, or the pack on their account isn't this one. */
  | { status: "not-ready" };

export async function runMatching(userId: string, packId: string, now = Date.now()): Promise<MatchingOutcome> {
  const [holding, record] = await Promise.all([getTradeHolding(userId, packId), getBidPackRecord(userId)]);
  if (!holding || !record || record.packId !== packId) return { status: "not-ready" };
  const meta = holding.bidPackMeta;
  const lockKey = `line-select:trade-matching:${meta.base}:${meta.aircraft}:${meta.seat}:${meta.month}`;
  if ((await incrementCounter(lockKey, RUN_SECONDS)) > 1) return { status: "busy" };
  try {
    const pack: BidPack = restoreBidPack(JSON.parse(gunzipSync(record.data).toString("utf8")));
    const [{ rows, names }, history] = await Promise.all([listMatchingGroup(meta), matchingHistory(meta, new Date(now))]);
    const everyone = pilotsForMatching(pack, rows);
    const available = everyone.filter((p) => !history.busyPilots.has(p.pilotId));
    const { trades } = findTrades(pack, available, { now, excludeSwap: (pilotId, give, take) => history.declined.has(swapKey(pilotId, give, take)) });
    const fresh = trades.filter((t) => !history.signatures.has(tradeSignature(pack.id, t.legs.map((l) => ({ pilotId: l.pilotId, give: l.value.give })))));
    let found = 0;
    for (const t of fresh) if (await saveSuggestion(suggestionToStore(pack, t, names))) found++;
    return { status: "ran", found, pilots: everyone.length };
  } finally {
    await setJson(lockKey, 0, { ttlSeconds: 1 });
  }
}
