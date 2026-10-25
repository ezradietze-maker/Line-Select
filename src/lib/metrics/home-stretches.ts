import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import type { Departure } from "@/lib/metrics/departures";
import type { BidPack } from "@/types/bidpack";

/**
 * Time at home the way a pilot lives it: each stretch from walking in the door after one departure to leaving for the
 * next, and the nights slept in their own bed. A month's days off say little about this for a commuter — a day off
 * spent commuting home, or getting in at 5 in the morning, isn't time at home, and calendar days off didn't line up
 * with the ex-pilot's own ranking of his lines at all. What did: how often the month leaves him only a short stretch
 * at home, and how many nights he's home (Oct 2026, his 20 lines: short stretches between departures 0.78 rank
 * agreement with his order, nights at home 0.50; days off 0.02).
 *
 * A real break is a stretch of at least `minBreakNights` nights at home (for him, three or four days at home is when it
 * starts to feel like one; the app's 71 hours and 3 nights between two of 1033's trip sequences match his own count).
 * A short gap is a stretch between two departures that falls short of one.
 *
 * A commuter's stretches come from the departures' door-to-door times (`metrics/departures.ts`). A pilot who lives at
 * base leaves home a little before each report and gets back a little after the last block-in. Stretches that run into
 * the month before or after count only their part inside this bid period, and never as short gaps — the rest of them
 * isn't in this pack.
 */

/** Nights at home that make a stretch a real break, unless the pilot says otherwise. */
export const DEFAULT_MIN_BREAK_NIGHTS = 3;
/** A pilot who lives at base leaves home this long before a report, and is home this long after the last block-in. */
const LIVES_AT_BASE_LEAVE_MINUTES = 60;
const LIVES_AT_BASE_HOME_MINUTES = 60;
/** A night at home is the 02:00 of it spent there, on the home clock. */
const NIGHT_HOUR = 2;

const HOUR = 3_600_000;

export interface HomeStretch {
  /** Walking in the door, and leaving again (ms, UTC), clipped to the bid period. */
  from: number;
  to: number;
  hours: number;
  /** Nights in their own bed. */
  nights: number;
  /** A stretch that runs into the month before ("start") or after ("end"): only its part in this bid period is here. */
  edge: "start" | "end" | null;
}

export interface HomeTime {
  stretches: HomeStretch[];
  /** Stretches between two departures shorter than a real break. */
  shortGaps: number;
  /** Nights at home in real breaks. */
  breakNights: number;
  /** Nights at home in the bid period. */
  nightsHome: number;
  /** The longest stretch at home, in nights. */
  longestNights: number;
}

/** Nights (each one's `NIGHT_HOUR`) between two instants on a clock. */
function nightsBetween(from: number, to: number, zone: string): number {
  let n = 0;
  let t = DateTime.fromMillis(from, { zone }).set({ hour: NIGHT_HOUR, minute: 0, second: 0, millisecond: 0 });
  if (t.toMillis() <= from) t = t.plus({ days: 1 });
  for (; t.toMillis() < to; t = t.plus({ days: 1 })) n++;
  return n;
}

/**
 * The stretches at home in a line's month, in order; null when any departure can't be placed (an estimated line) or a
 * commuter's door-to-door times can't be worked out — no stretch is then better than a wrong one.
 */
export function homeStretches(departures: Departure[], ctx: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">, homeAirports?: string[]): HomeStretch[] | null {
  if (!ctx.bidPeriodStart) return null;
  const homes = (homeAirports ?? []).filter((a) => a && a !== ctx.base);
  const commuter = homes.length > 0 && !(homeAirports ?? []).includes(ctx.base);
  const zone = timezoneForAirport(commuter ? homes[0] : ctx.base) ?? timezoneForAirport(ctx.base) ?? "UTC";
  const periodStart = DateTime.fromISO(ctx.bidPeriodStart, { zone }).toMillis();
  const periodEnd = DateTime.fromISO(ctx.bidPeriodStart, { zone }).plus({ days: ctx.bidPeriodDays }).toMillis();

  const away: { leave: number; back: number }[] = [];
  for (const d of departures) {
    const leave = commuter ? d.leaveHome : d.reportAt === null ? null : d.reportAt - LIVES_AT_BASE_LEAVE_MINUTES * 60_000;
    const back = commuter ? d.backHome : d.releaseAt === null ? null : d.releaseAt + LIVES_AT_BASE_HOME_MINUTES * 60_000;
    if (leave === null || back === null) return null;
    away.push({ leave, back });
  }
  away.sort((a, b) => a.leave - b.leave);

  const stretches: HomeStretch[] = [];
  const add = (from: number, to: number, edge: HomeStretch["edge"]) => {
    const a = Math.max(from, periodStart);
    const b = Math.min(to, periodEnd);
    if (b <= a) return;
    stretches.push({ from: a, to: b, hours: (b - a) / HOUR, nights: nightsBetween(a, b, zone), edge });
  };
  if (!away.length) add(periodStart, periodEnd, "start");
  else {
    add(periodStart, away[0].leave, "start");
    for (let i = 0; i + 1 < away.length; i++) add(away[i].back, away[i + 1].leave, away[i + 1].leave > periodEnd ? "end" : null);
    add(away[away.length - 1].back, periodEnd, "end");
  }
  return stretches;
}

export function summarizeHomeTime(stretches: HomeStretch[], minBreakNights = DEFAULT_MIN_BREAK_NIGHTS): HomeTime {
  const real = stretches.filter((s) => s.nights >= minBreakNights);
  return {
    stretches,
    shortGaps: stretches.filter((s) => s.edge === null && s.nights < minBreakNights).length,
    breakNights: real.reduce((a, s) => a + s.nights, 0),
    nightsHome: stretches.reduce((a, s) => a + s.nights, 0),
    longestNights: Math.max(0, ...stretches.map((s) => s.nights)),
  };
}

/** "Home 71h · 3 nights", "Home 9 days · 8 nights" — one stretch, the way the calendar says it. */
export function homeStretchLabel(s: HomeStretch): string {
  const h = Math.round(s.hours);
  const time = h < 96 ? `${h}h` : `${Math.round(h / 24)} days`;
  return `Home ${time} · ${s.nights} ${s.nights === 1 ? "night" : "nights"}`;
}
