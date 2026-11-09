import { longestDaysOffBlock, weekendDaysOff } from "@/lib/days-off-pattern";
import { computeTripFacts, type TripFacts } from "@/lib/metrics/trip-facts";
import { hasRedEyeLeg } from "@/lib/trip-analytics";
import type { Line, ReportTime, Trip } from "@/types/bidpack";

/** "any" = no routing filter applied. */
export type InternationalFilter = "any" | "international" | "domestic";
/** "any" = no filter; "3plus" = three or more trips. */
export type TripCountFilter = "any" | 1 | 2 | "3plus";
/** "any" = no filter. */
export type OutAndBackFilter = "any" | "only" | "none";

export interface LineFilters {
  /** 0 = no filter; a line qualifies when its daysOff is at least this. */
  minDaysOff: number;
  /** 0 = no filter; a line qualifies when its totalCreditHours is at least this. */
  minCreditHours: number;
  /** 0 = no filter; a line qualifies when its totalCreditHours is at most this. */
  maxCreditHours: number;
  /** 0 = no filter; a line qualifies when its TAFB is at least this. */
  minTafbHours: number;
  /** 0 = no filter; a line qualifies when its TAFB is at most this. */
  maxTafbHours: number;
  /** 0 = no filter; a line qualifies only when every trip's days is at most this — one long reach trip disqualifies the whole line. */
  maxTripDays: number;
  tripCount: TripCountFilter;
  /** Empty = no filter; a line qualifies when at least one trip reports at one of these times. */
  reportTimes: Set<ReportTime>;
  /** Empty = no filter; a line qualifies when at least one trip lays over in one of these cities. */
  cities: Set<string>;
  /** Empty = no filter; a line qualifies when at least one leg lands in or leaves one of these cities, layover or not. */
  touchedCities: Set<string>;
  /** When true, only lines with zero deadhead legs across every trip qualify. */
  noDeadheadsOnly: boolean;
  /** When true, excludes any line with a trip that starts on a deadhead. */
  noFrontDeadhead: boolean;
  /** When true, excludes any line with a trip that ends on a deadhead. */
  noBackDeadhead: boolean;
  /** When true, excludes any line with a trip that starts and ends on a deadhead. */
  noDoubleDeadhead: boolean;
  /** When true, excludes any line with a red-eye (00:00-05:00 local) departure or arrival on any trip. */
  noRedEyesOnly: boolean;
  /** When true, excludes a line whose trip breakdown is a same-totals estimate rather than a verified schedule — see `Line.estimated`. */
  verifiedOnly: boolean;
  international: InternationalFilter;
  /** Minutes after local midnight; null = no filter. Every departure on the line, deadheads included, is judged on the clock where it leaves. */
  noTakeoffBefore: number | null;
  noTakeoffAfter: number | null;
  /** Trips that go out to one city and straight back (see `isOutAndBack`). */
  outAndBacks: OutAndBackFilter;
  /** When true, only lines whose every flying duty has one operated leg qualify. */
  singleLegDutiesOnly: boolean;
  /** 0 = no filter; a line qualifies when its longest layover is at least this many hours. */
  minLongestLayoverHours: number;
  /** Empty = no filter; a line qualifies when one of its trips' pairing numbers contains this. */
  pairingContains: string;
  /** 0 = no filter; a line qualifies when its longest run of days off is at least this. */
  minDaysOffBlock: number;
  /** 0 = no filter; a line qualifies when its Saturdays and Sundays off come to at least this. */
  minWeekendDaysOff: number;
  /** When true, a line real flights say can't be commuted is out (see `lib/commute-filter.ts`); one not known stays in. */
  commuteOnly: boolean;
}

export const EMPTY_FILTERS: LineFilters = {
  minDaysOff: 0,
  minCreditHours: 0,
  maxCreditHours: 0,
  minTafbHours: 0,
  maxTafbHours: 0,
  maxTripDays: 0,
  tripCount: "any",
  reportTimes: new Set(),
  cities: new Set(),
  touchedCities: new Set(),
  noDeadheadsOnly: false,
  noFrontDeadhead: false,
  noBackDeadhead: false,
  noDoubleDeadhead: false,
  noRedEyesOnly: false,
  verifiedOnly: false,
  international: "any",
  noTakeoffBefore: null,
  noTakeoffAfter: null,
  outAndBacks: "any",
  singleLegDutiesOnly: false,
  minLongestLayoverHours: 0,
  pairingContains: "",
  minDaysOffBlock: 0,
  minWeekendDaysOff: 0,
  commuteOnly: false,
};

export type CommuteStatus = "yes" | "no" | "unknown";

/** What some filters read beyond the line: the pack's dates, and each line's commute check. */
export interface FilterContext {
  bidPeriodStart?: string | null;
  commute?: Map<string, CommuteStatus>;
}

const factsMemo = new WeakMap<Trip, TripFacts>();
/** The same pairing shows up in many lines, and filters run on every line for each change: facts are worked out once. */
function factsOf(trip: Trip): TripFacts {
  let f = factsMemo.get(trip);
  if (!f) factsMemo.set(trip, (f = computeTripFacts(trip)));
  return f;
}

/**
 * Out to one city and straight back: every leg, deadheads included, runs between where the trip starts and one other
 * city, and the trip ends where it started. MEM–ANC–MEM is one; MEM–ANC–HKG–ANC–MEM isn't.
 */
export function isOutAndBack(trip: Trip): boolean {
  const legs = factsOf(trip).legs;
  if (legs.length < 2) return false;
  const origin = legs[0].from;
  if (legs[legs.length - 1].to !== origin) return false;
  const away = new Set(legs.flatMap((l) => [l.from, l.to]).filter((c) => c !== origin));
  return away.size === 1;
}

/** Whether a departure at this local minute keeps out of the pilot's window. Set the other way round (22:00 to 06:00), the window runs overnight. */
function takeoffAllowed(minute: number, before: number | null, after: number | null): boolean {
  if (before !== null && after !== null && before > after) return minute >= before || minute <= after;
  return (before === null || minute >= before) && (after === null || minute <= after);
}

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

interface FilterPart {
  key: string;
  active: (f: LineFilters) => boolean;
  /** The filter on, in a pilot's words. */
  label: (f: LineFilters) => string;
  clear: Partial<LineFilters>;
  matches: (line: Line, f: LineFilters, ctx: FilterContext) => boolean;
}

/**
 * Hard constraints, independent of the preference score — a pilot narrowing "show me only lines that touch LAX"
 * shouldn't need to trust the AI ranking to get there. City and report-time filters use "at least one trip matches"
 * semantics: a multi-trip line qualifies if any of its trips fits, since excluding a whole line over one unwanted trip
 * would be too blunt. Each is one entry here, so what's on, what it removes and how to take it off can't disagree.
 */
const FILTER_PARTS: FilterPart[] = [
  {
    key: "minDaysOff",
    active: (f) => f.minDaysOff > 0,
    label: (f) => `At least ${f.minDaysOff} days off`,
    clear: { minDaysOff: 0 },
    matches: (l, f) => l.daysOff >= f.minDaysOff,
  },
  {
    key: "minDaysOffBlock",
    active: (f) => f.minDaysOffBlock > 0,
    label: (f) => `At least ${f.minDaysOffBlock} days off in a row`,
    clear: { minDaysOffBlock: 0 },
    matches: (l, f) => (longestDaysOffBlock(l) ?? 0) >= f.minDaysOffBlock,
  },
  {
    key: "minWeekendDaysOff",
    active: (f) => f.minWeekendDaysOff > 0,
    label: (f) => `At least ${f.minWeekendDaysOff} weekend days off`,
    clear: { minWeekendDaysOff: 0 },
    matches: (l, f, c) => (weekendDaysOff(l, c.bidPeriodStart ?? null) ?? 0) >= f.minWeekendDaysOff,
  },
  {
    key: "credit",
    active: (f) => f.minCreditHours > 0 || f.maxCreditHours > 0,
    label: (f) => (f.maxCreditHours > 0 ? `Credit ${f.minCreditHours > 0 ? `${f.minCreditHours} to ${f.maxCreditHours}` : `up to ${f.maxCreditHours}`} hours` : `At least ${f.minCreditHours} credit hours`),
    clear: { minCreditHours: 0, maxCreditHours: 0 },
    matches: (l, f) => l.totalCreditHours >= f.minCreditHours && (f.maxCreditHours === 0 || l.totalCreditHours <= f.maxCreditHours),
  },
  {
    key: "tafb",
    active: (f) => f.minTafbHours > 0 || f.maxTafbHours > 0,
    label: (f) => (f.minTafbHours > 0 && f.maxTafbHours > 0 ? `TAFB ${f.minTafbHours} to ${f.maxTafbHours} hours` : f.maxTafbHours > 0 ? `TAFB up to ${f.maxTafbHours} hours` : `TAFB at least ${f.minTafbHours} hours`),
    clear: { minTafbHours: 0, maxTafbHours: 0 },
    matches: (l, f) => l.totalTafbHours >= f.minTafbHours && (f.maxTafbHours === 0 || l.totalTafbHours <= f.maxTafbHours),
  },
  {
    key: "maxTripDays",
    active: (f) => f.maxTripDays > 0,
    label: (f) => `No trip over ${f.maxTripDays} days`,
    clear: { maxTripDays: 0 },
    matches: (l, f) => !l.trips.some((t) => t.days > f.maxTripDays),
  },
  {
    key: "tripCount",
    active: (f) => f.tripCount !== "any",
    label: (f) => (f.tripCount === "3plus" ? "3 or more trips" : f.tripCount === 1 ? "1 trip" : `${f.tripCount} trips`),
    clear: { tripCount: "any" },
    matches: (l, f) => (f.tripCount === "3plus" ? l.trips.length >= 3 : l.trips.length === f.tripCount),
  },
  {
    key: "reportTimes",
    active: (f) => f.reportTimes.size > 0,
    label: (f) => `Reports: ${[...f.reportTimes].join(", ")}`,
    clear: { reportTimes: new Set() },
    matches: (l, f) => l.trips.some((t) => f.reportTimes.has(t.reportTime)),
  },
  {
    key: "takeoff",
    active: (f) => f.noTakeoffBefore !== null || f.noTakeoffAfter !== null,
    label: (f) => (f.noTakeoffBefore !== null && f.noTakeoffAfter !== null ? `Takeoffs between ${clock(f.noTakeoffBefore)} and ${clock(f.noTakeoffAfter)}` : f.noTakeoffBefore !== null ? `No takeoff before ${clock(f.noTakeoffBefore)}` : `No takeoff after ${clock(f.noTakeoffAfter!)}`),
    clear: { noTakeoffBefore: null, noTakeoffAfter: null },
    // A departure with no local time printed can't be judged, so it can't count against the line.
    matches: (l, f) => l.trips.every((t) => factsOf(t).legs.every((leg) => leg.depLocalMinute === null || takeoffAllowed(leg.depLocalMinute, f.noTakeoffBefore, f.noTakeoffAfter))),
  },
  {
    key: "cities",
    active: (f) => f.cities.size > 0,
    label: (f) => `Lays over in ${[...f.cities].join(", ")}`,
    clear: { cities: new Set() },
    matches: (l, f) => l.trips.some((t) => t.layoverCities.some((c) => f.cities.has(c))),
  },
  {
    key: "touchedCities",
    active: (f) => f.touchedCities.size > 0,
    label: (f) => `Touches ${[...f.touchedCities].join(", ")}`,
    clear: { touchedCities: new Set() },
    matches: (l, f) => l.trips.some((t) => t.layoverCities.some((c) => f.touchedCities.has(c)) || factsOf(t).legs.some((leg) => f.touchedCities.has(leg.from) || f.touchedCities.has(leg.to))),
  },
  {
    key: "noDeadheadsOnly",
    active: (f) => f.noDeadheadsOnly,
    label: () => "No deadheads",
    clear: { noDeadheadsOnly: false },
    matches: (l) => !l.trips.some((t) => t.deadheadLegs > 0),
  },
  {
    key: "noFrontDeadhead",
    active: (f) => f.noFrontDeadhead,
    label: () => "No deadhead at the start of a trip",
    clear: { noFrontDeadhead: false },
    matches: (l) => !l.trips.some((t) => factsOf(t).front),
  },
  {
    key: "noBackDeadhead",
    active: (f) => f.noBackDeadhead,
    label: () => "No deadhead at the end of a trip",
    clear: { noBackDeadhead: false },
    matches: (l) => !l.trips.some((t) => factsOf(t).back),
  },
  {
    key: "noDoubleDeadhead",
    active: (f) => f.noDoubleDeadhead,
    label: () => "No double-deadhead trips",
    clear: { noDoubleDeadhead: false },
    matches: (l) => !l.trips.some((t) => factsOf(t).front && factsOf(t).back),
  },
  {
    key: "outAndBacks",
    active: (f) => f.outAndBacks !== "any",
    label: (f) => (f.outAndBacks === "only" ? "Out-and-backs only" : "No out-and-backs"),
    clear: { outAndBacks: "any" },
    matches: (l, f) => (f.outAndBacks === "none" ? !l.trips.some(isOutAndBack) : l.trips.length > 0 && l.trips.every(isOutAndBack)),
  },
  {
    key: "singleLegDutiesOnly",
    active: (f) => f.singleLegDutiesOnly,
    label: () => "Single-leg duties only",
    clear: { singleLegDutiesOnly: false },
    matches: (l) => {
      const duties = l.trips.flatMap((t) => factsOf(t).duties).filter((d) => d.operatedLegs > 0);
      return duties.length > 0 && duties.every((d) => d.operatedLegs === 1);
    },
  },
  {
    key: "minLongestLayoverHours",
    active: (f) => f.minLongestLayoverHours > 0,
    label: (f) => `A layover of at least ${f.minLongestLayoverHours} hours`,
    clear: { minLongestLayoverHours: 0 },
    matches: (l, f) => l.trips.some((t) => factsOf(t).layovers.some((lay) => lay.hours >= f.minLongestLayoverHours)),
  },
  {
    key: "pairingContains",
    active: (f) => f.pairingContains.trim() !== "",
    label: (f) => `Pairing number contains ${f.pairingContains.trim()}`,
    clear: { pairingContains: "" },
    matches: (l, f) => {
      const q = f.pairingContains.trim().toLowerCase();
      return l.trips.some((t) => t.pairingNumber?.toLowerCase().includes(q));
    },
  },
  {
    key: "noRedEyesOnly",
    active: (f) => f.noRedEyesOnly,
    label: () => "No night legs",
    clear: { noRedEyesOnly: false },
    matches: (l) => !l.trips.some(hasRedEyeLeg),
  },
  {
    key: "verifiedOnly",
    active: (f) => f.verifiedOnly,
    label: () => "Verified schedules only",
    clear: { verifiedOnly: false },
    matches: (l) => !l.estimated,
  },
  {
    key: "international",
    active: (f) => f.international !== "any",
    label: (f) => (f.international === "international" ? "International" : "Domestic"),
    clear: { international: "any" },
    matches: (l, f) => (f.international === "international" ? l.trips.some((t) => t.international) : !l.trips.some((t) => t.international)),
  },
  {
    key: "commuteOnly",
    active: (f) => f.commuteOnly,
    label: () => "Lines you can commute to and from",
    clear: { commuteOnly: false },
    // Unknown stays in: a gap in the flight data isn't a line you can't commute to.
    matches: (l, _f, c) => c.commute?.get(l.id) !== "no",
  },
];

export function filtersActive(filters: LineFilters): boolean {
  return activeFilterCount(filters) > 0;
}

export function activeFilterCount(filters: LineFilters): number {
  return FILTER_PARTS.filter((p) => p.active(filters)).length;
}

export function lineMatchesFilters(line: Line, filters: LineFilters, ctx: FilterContext = {}): boolean {
  return FILTER_PARTS.every((p) => !p.active(filters) || p.matches(line, filters, ctx));
}

export interface FilterBlame {
  key: string;
  label: string;
  /** Lines this filter takes out on its own. */
  removes: number;
  /** The filters with this one taken off. */
  without: LineFilters;
}

/** Each filter that's on, what it takes out and how to take it off, the one removing most first. */
export function blameFilters(lines: Line[], filters: LineFilters, ctx: FilterContext = {}): FilterBlame[] {
  return FILTER_PARTS.filter((p) => p.active(filters))
    .map((p) => ({
      key: p.key,
      label: p.label(filters),
      removes: lines.filter((l) => !p.matches(l, filters, ctx)).length,
      without: { ...filters, ...p.clear },
    }))
    .sort((a, b) => b.removes - a.removes);
}

/** A stable string for "what filters are on" — lets the page reset to the first page when they change without depending on Set identity. */
export function filtersKey(f: LineFilters): string {
  return JSON.stringify(f, (_k, v: unknown) => (v instanceof Set ? [...v].sort() : v));
}

/** Every distinct layover city across a bid pack's lines, sorted for a stable filter chip order. */
export function collectLayoverCities(lines: Line[]): string[] {
  const cities = new Set<string>();
  for (const line of lines) {
    for (const trip of line.trips) {
      for (const city of trip.layoverCities) cities.add(city);
    }
  }
  return [...cities].sort();
}

/** Every airport any leg touches, layover or not, for the "touches" filter. */
export function collectTouchedCities(lines: Line[]): string[] {
  const cities = new Set<string>();
  for (const line of lines) {
    for (const trip of line.trips) {
      for (const city of trip.layoverCities) cities.add(city);
      for (const leg of factsOf(trip).legs) {
        cities.add(leg.from);
        cities.add(leg.to);
      }
    }
  }
  return [...cities].sort();
}
