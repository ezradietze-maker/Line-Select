import { DateTime, IANAZone } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { CLIMATE_NORMALS, type MonthNormal } from "@/lib/climate-normals";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { Trip } from "@/types/bidpack";

/**
 * Seasons in a layover city, from its weather rather than the calendar. The ex-pilot's words: "the dead of winter"
 * is any month "where the forecast temperatures are in the 30's" — "probably DEC through MAR in ANC, BOS, EWR, and
 * other potentially cold/wet destinations" — and "mid summer" any month at "100+ (degrees F) in PHX or other desert
 * cities"; Honolulu he loves "slightly less during the height of the tourist season (JUN-AUG)", which no thermometer
 * shows, so a pilot can pick months of their own too. A city with a mild climate has no winter at all: "a Sydney
 * layover any time of year … is great."
 *
 * Winter and summer here are each city's own, from `CLIMATE_NORMALS`, so they come out right south of the equator too.
 */

/**
 * A month is a city's dead of winter when at least this share of its nights freeze — the cold he means, and the one that
 * brings de-icing. It gives Boston and Newark December–February, Minneapolis November–March and Anchorage November–April,
 * while Anchorage's October (15 of 31 nights) stays out. His "probably DEC through MAR" can't be matched exactly by any
 * rule: Boston's March (15 of 31) and Anchorage's October are the same weather.
 */
export const WINTER_FREEZE_SHARE = 0.5;
/**
 * A month averaging a high of this or more is summer heat, whatever else the year does there. Not 100: Phoenix's
 * September averages 101 °F, and of a 37-hour Phoenix layover on September 30 he said "36 hours in PHX is OK" — his
 * "100+" is the forecast in the hottest stretch, not a month's average. At 102, Riyadh's September (105 °F) still counts.
 */
export const HEAT_HIGH_F = 102;

export type Season = "winter" | "summer";

/** A city's grade (−1 … +1) in some months, where it differs from its usual one. */
export interface SeasonScores {
  winter?: number;
  summer?: number;
  /** Months the pilot picked themselves (1 = January), a grade for each group; these come first. */
  months?: { months: number[]; score: number }[];
}

const daysIn = (month: number) => (month === 2 ? 28.25 : [4, 6, 9, 11].includes(month) ? 30 : 31);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const seasonCache = new Map<string, { winter: number[]; summer: number[] } | null>();

/** The months (1 = January) that are a city's dead of winter and its summer; null when its weather isn't on record. */
export function seasonMonths(code: string): { winter: number[]; summer: number[] } | null {
  if (seasonCache.has(code)) return seasonCache.get(code)!;
  const normals: MonthNormal[] | undefined = CLIMATE_NORMALS[code];
  let out: { winter: number[]; summer: number[] } | null = null;
  if (normals) {
    const month = (i: number) => i + 1;
    const winter = normals.flatMap((n, i) => (n.freezeNights / daysIn(month(i)) >= WINTER_FREEZE_SHARE ? [month(i)] : []));
    // Its three warmest months, plus any month of desert heat.
    const warmest = normals.map((n, i) => ({ i, high: n.highF })).sort((a, b) => b.high - a.high).slice(0, 3).map((x) => x.i);
    const summer = normals.flatMap((n, i) => (warmest.includes(i) || n.highF >= HEAT_HIGH_F ? [month(i)] : []));
    out = { winter, summer };
  }
  seasonCache.set(code, out);
  return out;
}

/** Which season a month is in a city, or null when it's neither (or the weather isn't on record). */
export function seasonOf(code: string, month: number): Season | null {
  const s = seasonMonths(code);
  if (!s) return null;
  return s.winter.includes(month) ? "winter" : s.summer.includes(month) ? "summer" : null;
}

/** A city's grade in a month: the pilot's own months first, then its winter or summer grade, else its usual one. */
export function scoreInMonth(usual: number, seasons: SeasonScores | undefined, code: string, month: number | null): number {
  if (!seasons || month === null) return usual;
  // A list since Nov 2026; a model saved before then may hold one group.
  const groups = Array.isArray(seasons.months) ? seasons.months : seasons.months ? [seasons.months as { months: number[]; score: number }] : [];
  const picked = groups.find((g) => g.months.includes(month));
  if (picked) return picked.score;
  const season = seasonOf(code, month);
  if (season === "winter" && seasons.winter !== undefined) return seasons.winter;
  if (season === "summer" && seasons.summer !== undefined) return seasons.summer;
  return usual;
}

/** Each trip's first report as an instant, by bid period start — measures ask for it once per layover and takeoff. */
const reportCache = new WeakMap<object, Map<string, number | null>>();
const zoneCache = new Map<string, IANAZone>();

/**
 * The month (1 = January) at a city some minutes after a trip's first report, on the city's own calendar. A trip the
 * grid didn't place takes the bid period's middle; null without a bid period at all.
 */
export function monthAt(pack: { bidPeriodStart?: string | null; base?: string }, trip: Pick<Trip, "startDayIndex" | "schedule">, minutes: number, city: string): number | null {
  const start = pack.bidPeriodStart;
  if (!start) return null;
  let byStart = reportCache.get(trip);
  if (!byStart) reportCache.set(trip, (byStart = new Map()));
  const key = `${start}|${pack.base ?? ""}`;
  let report = byStart.get(key);
  if (report === undefined) {
    report = pack.base ? tripReportUtc({ bidPeriodStart: start, base: pack.base }, trip) : null;
    byStart.set(key, report);
  }
  if (report === null) return DateTime.fromISO(start, { zone: "UTC" }).plus({ days: 14 }).month;
  const at = report + minutes * 60_000;
  return new Date(at + offsetAt(timezoneForAirport(city) ?? "UTC", at) * 60_000).getUTCMonth() + 1;
}

/** A zone's offset from UTC in minutes at an instant, kept by the hour: every takeoff of a pack asks. */
const offsetCache = new Map<string, number>();
function offsetAt(name: string, at: number): number {
  const key = `${name}|${Math.floor(at / 3_600_000)}`;
  let offset = offsetCache.get(key);
  if (offset === undefined) {
    let zone = zoneCache.get(name);
    if (!zone) zoneCache.set(name, (zone = IANAZone.create(name)));
    offsetCache.set(key, (offset = zone.offset(at)));
  }
  return offset;
}

/** How often it freezes overnight in a city in a month, 0–1 — when de-icing comes in. Null when its weather isn't on record. */
export function freezeShare(code: string, month: number): number | null {
  const n = CLIMATE_NORMALS[code]?.[month - 1];
  if (!n) return null;
  return Math.max(0, Math.min(1, n.freezeNights / daysIn(month)));
}

/** "Dec–Mar", "Jun–Aug", "Jan, Mar" — months as a pilot reads them, runs joined (and wrapping over the new year). */
export function monthsWords(months: number[]): string {
  const set = new Set(months);
  if (set.size === 0) return "";
  if (set.size === 12) return "all year";
  // Start a run where the month before isn't in the set, so Dec–Feb reads as one run.
  const starts = [...set].filter((m) => !set.has(m === 1 ? 12 : m - 1)).sort((a, b) => a - b);
  return starts
    .map((start) => {
      let end = start;
      while (set.has(end === 12 ? 1 : end + 1) && (end === 12 ? 1 : end + 1) !== start) end = end === 12 ? 1 : end + 1;
      return end === start ? MONTHS[start - 1] : `${MONTHS[start - 1]}–${MONTHS[end - 1]}`;
    })
    .join(", ");
}

export const monthName = (month: number) => MONTHS[month - 1];
