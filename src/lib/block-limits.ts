import { DateTime } from "luxon";
import { useSyncExternalStore } from "react";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { isInternationalCity } from "@/lib/pdf-parser/airports";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * The federal flight-time limits a line can run into. FedEx flies under 14 CFR Part 121, not Part 117 (all-cargo
 * carriers are carved out of it), and the 2026 contract adds no monthly cap of its own (Section 12):
 *  - domestic (121.471): 30 hours in any 7 consecutive days, 100 in a calendar month, 1,000 in a calendar year;
 *  - flag, two pilots (121.481): 32 hours in any 7 consecutive days, 100 in a calendar month, 1,000 in 12 months.
 * Flying with a relief pilot (an augmented crew: 121.483, 121.485) has limits of its own, and FedEx builds every duty over
 * 7:35 block with one (CBA 2026 25.U.3 example). So a duty over 8 block hours marks its legs augmented, and a 7-day window
 * or month with any of them isn't checked here at all, rather than flagged against the two-pilot limits it isn't flown
 * under. Only legs the pilot operates count: deadheads and hotel standby aren't flight time.
 */

export const MONTH_LIMIT = 100;
export const YEAR_LIMIT = 1000;
export const WEEK_LIMIT_DOMESTIC = 30;
export const WEEK_LIMIT_FLAG = 32;
/**
 * Within this much of a limit, a line is said to come close: 5 hours of a month or a year (Crew Planning reportedly plans
 * around 95 hours in 30 days), and 2 of a week, where 5 would be a sixth of the limit and flag ordinary busy weeks.
 */
export const CLOSE_MARGIN: Record<"week" | "month" | "year", number> = { week: 2, month: 5, year: 5 };

const WEEK_MS = 7 * 24 * 3_600_000;

/** What the pilot has flown before this bid period, which only they know. */
export interface FlownSoFar {
  /** Block hours in the calendar month the bid period starts in, before it starts. */
  monthHours?: number;
  /** Block hours this calendar year before the bid period starts. */
  yearHours?: number;
}

export interface FlownLeg {
  flightNumber: string;
  from: string;
  to: string;
  /** Epoch ms of departure. */
  at: number;
  block: number;
  international: boolean;
  /** In a duty over 8 block hours: flown with a relief pilot, under limits this doesn't check. */
  augmented: boolean;
}

/** A duty with more block than this is flown with a relief pilot (FedEx adds one past 7:35). */
const AUGMENTED_DUTY_BLOCK = 8;

export type LimitKind = "week" | "month" | "year";

export interface LimitFinding {
  kind: LimitKind;
  /** "over" the limit, or "close" to it (within `CLOSE_MARGIN`). */
  level: "over" | "close";
  hours: number;
  limit: number;
  /** "October", "Oct 3–9", "2026". */
  when: string;
  /** Hours the pilot told us they'd flown before, included in `hours`. */
  before: number;
  /** The legs of this line counted toward it. */
  legs: FlownLeg[];
  rule: string;
}

/** The line's operating legs, each on its real departure instant (counted from its trip's report, as the calendar is). */
export function flownLegs(pack: Pick<BidPack, "bidPeriodStart" | "base">, line: Pick<Line, "trips">): FlownLeg[] {
  const legs: FlownLeg[] = [];
  for (const trip of line.trips) {
    const report = tripReportUtc(pack, trip);
    if (report === null) continue;
    for (const duty of trip.schedule) {
      const dutyBlock = duty.totals?.blockHours ?? duty.legs.reduce((s, l) => s + (!l.isDeadhead && !l.isStandby && l.blockHours ? l.blockHours : 0), 0);
      const augmented = dutyBlock > AUGMENTED_DUTY_BLOCK;
      for (const leg of duty.legs) {
        if (leg.isDeadhead || leg.isStandby || !leg.blockHours || leg.blockHours <= 0) continue;
        legs.push({
          flightNumber: leg.flightNumber,
          from: leg.depAirport,
          to: leg.arrAirport,
          at: report + leg.startMinutes * 60_000,
          block: leg.blockHours,
          international: isInternationalCity(leg.depAirport) || isInternationalCity(leg.arrAirport),
          augmented,
        });
      }
    }
  }
  return legs.sort((a, b) => a.at - b.at);
}

const sum = (legs: FlownLeg[]) => legs.reduce((s, l) => s + l.block, 0);
const round = (h: number) => Math.round(h * 100) / 100;

function finding(kind: LimitKind, hours: number, limit: number, rest: Omit<LimitFinding, "kind" | "level" | "hours" | "limit">): LimitFinding | null {
  if (hours > limit) return { kind, level: "over", hours: round(hours), limit, ...rest };
  if (hours >= limit - CLOSE_MARGIN[kind]) return { kind, level: "close", hours: round(hours), limit, ...rest };
  return null;
}

/**
 * Where a line goes over, or comes close to, a limit, worst first. Months and the year are counted in the base's local
 * time; what came before the bid period is the pilot's own number, added to the month the period starts in and to the
 * year. Nothing is said about a line that stays clear: it can only be checked against what's known.
 */
export function lineBlockLimits(pack: Pick<BidPack, "bidPeriodStart" | "base">, line: Pick<Line, "trips">, before: FlownSoFar = {}): LimitFinding[] {
  const legs = flownLegs(pack, line);
  if (!legs.length || !pack.bidPeriodStart) return [];
  const zone = timezoneForAirport(pack.base) ?? "UTC";
  const local = (ms: number) => DateTime.fromMillis(ms, { zone });
  const start = DateTime.fromISO(pack.bidPeriodStart, { zone });
  const out: LimitFinding[] = [];

  // Calendar months: the one the bid period starts in carries what was flown before it.
  const months = new Map<string, FlownLeg[]>();
  for (const l of legs) {
    const key = local(l.at).toFormat("yyyy-LL");
    months.set(key, [...(months.get(key) ?? []), l]);
  }
  for (const [key, inMonth] of months) {
    if (inMonth.some((l) => l.augmented)) continue;
    const carried = key === start.toFormat("yyyy-LL") ? before.monthHours ?? 0 : 0;
    const f = finding("month", sum(inMonth) + carried, MONTH_LIMIT, {
      when: DateTime.fromFormat(key, "yyyy-LL", { zone }).toFormat("LLLL"),
      before: carried,
      legs: inMonth,
      rule: "14 CFR 121.471 and 121.481: 100 hours in a calendar month",
    });
    if (f) out.push(f);
  }

  // Any 7 days in a row: the worst window starting at each departure.
  let worst: { hours: number; legs: FlownLeg[] } | null = null;
  for (let i = 0; i < legs.length; i++) {
    const inWeek = legs.filter((l) => l.at >= legs[i].at && l.at < legs[i].at + WEEK_MS);
    if (inWeek.some((l) => l.augmented)) continue;
    const hours = sum(inWeek);
    const limit = inWeek.some((l) => l.international) ? WEEK_LIMIT_FLAG : WEEK_LIMIT_DOMESTIC;
    if (!worst || hours - limit > worst.hours - (worst.legs.some((l) => l.international) ? WEEK_LIMIT_FLAG : WEEK_LIMIT_DOMESTIC)) worst = { hours, legs: inWeek };
  }
  if (worst) {
    const intl = worst.legs.some((l) => l.international);
    const first = local(worst.legs[0].at);
    // 168 hours from a mid-morning departure reach into the 8th calendar day: name it when a counted leg flies then.
    const sixth = first.plus({ days: 6 });
    const lastLeg = local(worst.legs[worst.legs.length - 1].at);
    const end = lastLeg.startOf("day") > sixth.startOf("day") ? lastLeg : sixth;
    const f = finding("week", worst.hours, intl ? WEEK_LIMIT_FLAG : WEEK_LIMIT_DOMESTIC, {
      when: `${first.toFormat("LLL d")}–${end.toFormat(end.month === first.month ? "d" : "LLL d")}`,
      before: 0,
      legs: worst.legs,
      rule: intl ? "14 CFR 121.481: 32 hours in any 7 consecutive days (two pilots)" : "14 CFR 121.471: 30 hours in any 7 consecutive days",
    });
    if (f) out.push(f);
  }

  // The year: only with the pilot's own count, and only the legs in the year the period starts in.
  if (before.yearHours !== undefined) {
    const inYear = legs.filter((l) => local(l.at).year === start.year);
    // 1,000 hours a year holds for augmented flying too (121.483, 121.485), so the year counts every leg.
    const f = finding("year", sum(inYear) + before.yearHours, YEAR_LIMIT, {
      when: String(start.year),
      before: before.yearHours,
      legs: inYear,
      rule: "14 CFR 121.471: 1,000 hours in a calendar year",
    });
    if (f) out.push(f);
  }
  return out.sort((a, b) => (a.level === b.level ? b.hours / b.limit - a.hours / a.limit : a.level === "over" ? -1 : 1));
}

/** "101:20" — hours and minutes, as the pack prints block. */
export function hhmm(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** One finding in a sentence: "Over the 100-hour limit in October: 101:20, with the 70:00 you'd flown before." */
export function describeFinding(f: LimitFinding): string {
  const span = f.kind === "week" ? `in 7 days (${f.when})` : f.kind === "month" ? `in ${f.when}` : `in ${f.when}`;
  const limit = f.limit.toLocaleString("en-US");
  const lead = f.level === "over" ? `Over the ${limit}-hour limit ${span}` : `Within ${hhmm(f.limit - f.hours)} of the ${limit}-hour limit ${span}`;
  const before = f.before > 0 ? `, with the ${hhmm(f.before)} you'd flown before` : "";
  return `${lead}: ${hhmm(f.hours)} block${before}.`;
}

// ---- What the pilot has flown, kept on this device for each pack ----

const KEY = "line-select:flown-so-far:v1:";
const CHANGED = "line-select:flown-so-far-changed";

/** Hours as typed: "64.5", "64:30" or "64"; nothing for anything else. */
export function readHours(text: string): number | undefined {
  const t = text.trim();
  const hm = t.match(/^(\d{1,4}):([0-5]\d)$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(t);
  return t && Number.isFinite(n) && n >= 0 && n < 10000 ? n : undefined;
}

function load(packId: string): string {
  try {
    return window.localStorage.getItem(KEY + packId) ?? "";
  } catch {
    return "";
  }
}

export function parseFlownSoFar(raw: string): FlownSoFar {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const pick = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 10000 ? x : undefined);
    const out: FlownSoFar = {};
    const month = pick(v.monthHours);
    const year = pick(v.yearHours);
    if (month !== undefined) out.monthHours = month;
    if (year !== undefined) out.yearHours = year;
    return out;
  } catch {
    return {};
  }
}

export function saveFlownSoFar(packId: string, value: FlownSoFar): void {
  try {
    if (value.monthHours === undefined && value.yearHours === undefined) window.localStorage.removeItem(KEY + packId);
    else window.localStorage.setItem(KEY + packId, JSON.stringify(value));
  } catch {
    // unavailable storage: still used for this visit
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** What the pilot said they'd flown before this pack's bid period, as stored text: parse with `parseFlownSoFar`. */
export function useFlownSoFarRaw(packId: string): string {
  return useSyncExternalStore(subscribe, () => load(packId), () => "");
}
