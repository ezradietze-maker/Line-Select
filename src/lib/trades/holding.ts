import { isPackId } from "@/lib/pack-id";
import type { CarryInItem, ReservePeriod } from "@/lib/phase-in";
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

/** More than a month's carry-in could hold: a carried-in trip or two, and a block of R-days. */
const MAX_CARRY_IN = 10;
const MAX_DUTIES = 40;
const RESERVE_PERIODS = new Set<string>(["A", "A+", "B", "B+", "24"]);
const isInstant = (v: unknown): v is string => isText(v, 40) && Number.isFinite(Date.parse(v));
const isHours = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1000;

/**
 * One thing carried in from last month, as this device keeps it (`carry-in-storage.ts`), with only the fields the checks
 * read. Null when it isn't one, or its times can't be read: a span that can't be placed can't be fitted around. The
 * pilot types the label, so a long one is cut, not refused.
 */
function readCarryItem(value: unknown): CarryInItem | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.label !== "string") return null;
  const id = c.id.slice(0, 100);
  const label = c.label.trim().slice(0, 60) || "carry-in";
  if (c.kind === "trip") {
    if (!isInstant(c.report) || !isInstant(c.release) || Date.parse(c.release) <= Date.parse(c.report) || typeof c.international !== "boolean") return null;
    const item: CarryInItem = { kind: "trip", id, label, report: c.report, release: c.release, international: c.international };
    if (c.creditHours === null || isHours(c.creditHours)) item.creditHours = c.creditHours as number | null;
    if (isHours(c.lastDutyBlockHours)) item.lastDutyBlockHours = c.lastDutyBlockHours;
    if (c.duties !== undefined) {
      if (!Array.isArray(c.duties) || c.duties.length > MAX_DUTIES) return null;
      const duties = (c.duties as Record<string, unknown>[]).map((d) => (typeof d === "object" && d !== null && isInstant(d.start) && isInstant(d.end) ? { start: d.start, end: d.end } : null));
      if (duties.some((d) => !d)) return null;
      item.duties = duties as { start: string; end: string }[];
    }
    return item;
  }
  if (c.kind === "rdays") {
    if (typeof c.firstDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.firstDay) || !Number.isFinite(Date.parse(c.firstDay))) return null;
    if (!Number.isInteger(c.days) || (c.days as number) < 1 || (c.days as number) > 31 || !RESERVE_PERIODS.has(c.rp as string)) return null;
    return { kind: "rdays", id, label, firstDay: c.firstDay, days: c.days as number, rp: c.rp as ReservePeriod };
  }
  return null;
}

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
  // Left out by a browser from before it was sent, or not readable: not known, which the matching treats with care
  // (`PilotHolding.carryIn`). Never a reason to refuse what they hold.
  let carryIn: CarryInItem[] | undefined;
  if (Array.isArray(v.carryIn) && v.carryIn.length <= MAX_CARRY_IN) {
    const items = v.carryIn.map(readCarryItem);
    if (items.every((c) => c)) carryIn = items as CarryInItem[];
  }
  return {
    packId: v.packId,
    bidPackMeta: { base: meta.base, aircraft: meta.aircraft, seat: meta.seat, month: meta.month },
    lineNumber: v.lineNumber as string | null,
    trips,
    ...(carryIn ? { carryIn } : {}),
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

/**
 * One row per pilot: a pilot who confirmed what they hold under the pack's older id (`isPackId`) and again under its own
 * has two, and matched as two pilots, they could be handed two trips in one chain. The one under the pack's own id is
 * what they hold now.
 */
function onePerPilot(pack: BidPack, rows: readonly MatchingRow[]): MatchingRow[] {
  const byUser = new Map<string, MatchingRow>();
  for (const r of rows) {
    if (!r.holding || !isPackId(r.holding.packId, pack)) continue;
    const kept = byUser.get(r.userId);
    if (!kept || (kept.holding!.packId !== pack.id && r.holding.packId === pack.id)) byUser.set(r.userId, r);
  }
  return [...byUser.values()];
}

/** The pilots who can appear on a trade in this pack: they've confirmed what they hold, haven't turned suggestions off, and have finished an interview. Each once. */
export function pilotsForMatching(pack: BidPack, rows: readonly MatchingRow[]): PilotHolding[] {
  return onePerPilot(pack, rows).flatMap((r) => {
    if (!r.holding || !r.settings.suggestMe) return [];
    // What the pilot's rankings are scored on: the model the interview confirmed, as fitted to the swaps they've made since.
    const model = r.profile?.pilotModel ?? null;
    const line = heldLine(pack, r.holding, `held-${r.userId}`);
    if (!model || !line) return [];
    const locked = new Set(r.holding.trips.filter((t) => t.lock).map(tripInstanceKey));
    return [{ pilotId: r.userId, model, line, seniority: r.profile?.seniorityNumber ?? null, locked, ...(r.holding.carryIn ? { carryIn: r.holding.carryIn } : {}) }];
  });
}
