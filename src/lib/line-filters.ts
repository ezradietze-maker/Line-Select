import { hasRedEyeLeg } from "@/lib/trip-analytics";
import type { Line, ReportTime } from "@/types/bidpack";

/** "any" = no routing filter applied. */
export type InternationalFilter = "any" | "international" | "domestic";
/** "any" = no filter; "3plus" = three or more trips. */
export type TripCountFilter = "any" | 1 | 2 | "3plus";

export interface LineFilters {
  /** 0 = no filter; a line qualifies when its daysOff is at least this. */
  minDaysOff: number;
  /** 0 = no filter; a line qualifies when its totalCreditHours is at least this. */
  minCreditHours: number;
  /** 0 = no filter; a line qualifies only when every trip's days is at most this — one long reach trip disqualifies the whole line. */
  maxTripDays: number;
  tripCount: TripCountFilter;
  /** Empty = no filter; a line qualifies when at least one trip reports at one of these times. */
  reportTimes: Set<ReportTime>;
  /** Empty = no filter; a line qualifies when at least one trip lays over in one of these cities. */
  cities: Set<string>;
  /** When true, only lines with zero deadhead legs across every trip qualify. */
  noDeadheadsOnly: boolean;
  /** When true, excludes any line with a red-eye (00:00-05:00 local) departure or arrival on any trip. */
  noRedEyesOnly: boolean;
  /** When true, excludes a line whose trip breakdown is a same-totals estimate rather than a verified schedule — see `Line.estimated`. */
  verifiedOnly: boolean;
  international: InternationalFilter;
}

export const EMPTY_FILTERS: LineFilters = {
  minDaysOff: 0,
  minCreditHours: 0,
  maxTripDays: 0,
  tripCount: "any",
  reportTimes: new Set(),
  cities: new Set(),
  noDeadheadsOnly: false,
  noRedEyesOnly: false,
  verifiedOnly: false,
  international: "any",
};

export function filtersActive(filters: LineFilters): boolean {
  return activeFilterCount(filters) > 0;
}

export function activeFilterCount(filters: LineFilters): number {
  return (
    (filters.minDaysOff > 0 ? 1 : 0) +
    (filters.minCreditHours > 0 ? 1 : 0) +
    (filters.maxTripDays > 0 ? 1 : 0) +
    (filters.tripCount !== "any" ? 1 : 0) +
    (filters.reportTimes.size > 0 ? 1 : 0) +
    (filters.cities.size > 0 ? 1 : 0) +
    (filters.noDeadheadsOnly ? 1 : 0) +
    (filters.noRedEyesOnly ? 1 : 0) +
    (filters.verifiedOnly ? 1 : 0) +
    (filters.international !== "any" ? 1 : 0)
  );
}

/**
 * Hard constraints, independent of the preference score — a pilot narrowing
 * "show me only lines that touch LAX" shouldn't need to trust the AI ranking
 * to get there. City and report-time filters use "at least one trip
 * matches" semantics: a multi-trip line qualifies if any of its trips fits,
 * since excluding a whole line over one unwanted trip would be too blunt.
 */
export function lineMatchesFilters(line: Line, filters: LineFilters): boolean {
  if (line.daysOff < filters.minDaysOff) return false;
  if (line.totalCreditHours < filters.minCreditHours) return false;

  if (filters.maxTripDays > 0) {
    if (line.trips.some((t) => t.days > filters.maxTripDays)) return false;
  }

  if (filters.tripCount !== "any") {
    const count = line.trips.length;
    const matches = filters.tripCount === "3plus" ? count >= 3 : count === filters.tripCount;
    if (!matches) return false;
  }

  if (filters.reportTimes.size > 0) {
    if (!line.trips.some((t) => filters.reportTimes.has(t.reportTime))) return false;
  }

  if (filters.cities.size > 0) {
    const lineCities = new Set(line.trips.flatMap((t) => t.layoverCities));
    if (![...filters.cities].some((c) => lineCities.has(c))) return false;
  }

  if (filters.noDeadheadsOnly) {
    if (line.trips.some((t) => t.deadheadLegs > 0)) return false;
  }

  if (filters.noRedEyesOnly) {
    if (line.trips.some(hasRedEyeLeg)) return false;
  }

  if (filters.verifiedOnly) {
    if (line.estimated) return false;
  }

  if (filters.international === "international") {
    if (!line.trips.some((t) => t.international)) return false;
  } else if (filters.international === "domestic") {
    if (line.trips.some((t) => t.international)) return false;
  }

  return true;
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
