import { isPackId } from "@/lib/pack-id";
import { fromPhase2, tripInstanceKey } from "@/lib/trades/legality";
import type { PilotHolding } from "@/lib/trades/match";
import { lineWithTrips } from "@/lib/trades/value";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { HeldTrip, TradeHolding, TradeLock, TradeSettings } from "@/types/trade";

/**
 * What a pilot says they hold, and how that becomes a pilot the matching can work with. The site can't see VIPS, so this
 * comes from the pilot, and only pilots who've confirmed it are ever matched: nobody appears on a trade by accident.
 */

const MAX_TRIPS = 40;

const LOCKS: { lock: TradeLock; label: string; fromPhase2?: boolean }[] = [
  { lock: "VLT", label: "VLT" },
  { lock: "DRF", label: "DRF" },
  { lock: "AVA", label: "AVA" },
  { lock: "CMU", label: "CMU" },
  { lock: "PDO", label: "PDO" },
  // CBA 2026 25.L.1.h adds PMU from the December 2026 bid period (Phase 2).
  { lock: "PMU", label: "PMU", fromPhase2: true },
  { lock: "RSV", label: "RSV" },
  { lock: "checkRide", label: "Check ride" },
  { lock: "deviation", label: "Deviated deadhead, within 14 days" },
];

/** The reasons a pilot can pick for not being able to trade a trip in this bid period. */
export function tradeLocksFor(pack: Pick<BidPack, "month">): { lock: TradeLock; label: string }[] {
  return LOCKS.filter((l) => !l.fromPhase2 || fromPhase2(pack));
}

const ALL_LOCKS = new Set<string>(LOCKS.map((l) => l.lock));

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** A holding as sent by a browser, or null if it isn't one. The sample pack isn't anyone's to trade. */
export function readHolding(value: unknown): Omit<TradeHolding, "confirmedAt"> | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const meta = v.bidPackMeta as Record<string, unknown> | null | undefined;
  if (!isText(v.packId, 200) || v.packId.startsWith("sample")) return null;
  if (!meta || !isText(meta.base, 10) || !isText(meta.aircraft, 20) || !isText(meta.seat, 10) || !isText(meta.month, 10)) return null;
  if (v.lineNumber !== null && !isText(v.lineNumber, 20)) return null;
  if (!Array.isArray(v.trips) || v.trips.length === 0 || v.trips.length > MAX_TRIPS) return null;
  const trips: HeldTrip[] = [];
  for (const t of v.trips as Record<string, unknown>[]) {
    if (typeof t !== "object" || t === null || !isText(t.id, 200)) return null;
    if (!Number.isInteger(t.startDayIndex) || (t.startDayIndex as number) < 0 || (t.startDayIndex as number) > 70) return null;
    if (t.lock !== null && !ALL_LOCKS.has(t.lock as string)) return null;
    trips.push({ id: t.id, startDayIndex: t.startDayIndex as number, lock: t.lock as TradeLock | null });
  }
  return {
    packId: v.packId,
    bidPackMeta: { base: meta.base, aircraft: meta.aircraft, seat: meta.seat, month: meta.month },
    lineNumber: v.lineNumber as string | null,
    trips,
  };
}

/** Every trip in the pack on every date it flies, once each, by date. */
export function tripInstances(pack: BidPack): Trip[] {
  const seen = new Map<string, Trip>();
  for (const line of pack.lines) {
    if (line.estimated) continue;
    for (const t of line.trips) if (t.startDayIndex !== null && t.schedule.length > 0 && !seen.has(tripInstanceKey(t))) seen.set(tripInstanceKey(t), t);
  }
  return [...seen.values()].sort((a, b) => a.startDayIndex! - b.startDayIndex!);
}

/** A line's trips, as a pilot holding it would confirm them. Only trips placed on a date can be held here. */
export function heldTripsOfLine(line: Line): HeldTrip[] {
  return line.trips.flatMap((t) => (t.startDayIndex === null ? [] : [{ id: t.id, startDayIndex: t.startDayIndex, lock: null }]));
}

/**
 * The pilot's month as a line, from what they hold: their awarded line with any trades applied, or built up from nothing
 * once it no longer started from one. Null when the pack doesn't hold every one of the trips, as after a pack is replaced:
 * a schedule with holes would be matched as if those days were free.
 */
export function heldLine(pack: BidPack, holding: Pick<TradeHolding, "lineNumber" | "trips">, id: string): Line | null {
  const byKey = new Map(pack.lines.flatMap((l) => l.trips.map((t) => [tripInstanceKey(t), t] as const)));
  const trips = holding.trips.map((h) => byKey.get(tripInstanceKey(h)));
  if (trips.some((t) => !t)) return null;
  const wanted = trips as Trip[];
  const keys = new Set(wanted.map(tripInstanceKey));
  const start = pack.lines.find((l) => l.lineNumber === holding.lineNumber);
  const base: Line = start ?? {
    id,
    lineNumber: "held",
    trips: [],
    daysOff: pack.bidPeriodDays,
    totalCreditHours: 0,
    totalTafbHours: 0,
    totalLandings: 0,
    totalDepartures: 0,
  };
  const remove = base.trips.filter((t) => !keys.has(tripInstanceKey(t)));
  const have = new Set(base.trips.map(tripInstanceKey));
  const add = wanted.filter((t) => !have.has(tripInstanceKey(t)));
  return lineWithTrips(base, remove, add, id);
}

/** One pilot's data as the server holds it, for working out trades. */
export interface MatchingRow {
  userId: string;
  holding: TradeHolding | null;
  settings: TradeSettings;
  profile: PreferenceProfile | null;
}

/** The pilots who can appear on a trade in this pack: they've confirmed what they hold, haven't turned suggestions off, and have finished an interview. */
export function pilotsForMatching(pack: BidPack, rows: readonly MatchingRow[]): PilotHolding[] {
  return rows.flatMap((r) => {
    if (!r.holding || !r.settings.suggestMe || !isPackId(r.holding.packId, pack)) return [];
    // What the pilot's rankings are scored on: the model the interview confirmed, as fitted to the swaps they've made since.
    const model = r.profile?.pilotModel ?? null;
    const line = heldLine(pack, r.holding, `held-${r.userId}`);
    if (!model || !line) return [];
    const locked = new Set(r.holding.trips.filter((t) => t.lock).map(tripInstanceKey));
    return [{ pilotId: r.userId, model, line, seniority: r.profile?.seniorityNumber ?? null, locked }];
  });
}
