import { hasRedEyeLeg } from "@/lib/trip-analytics";
import type { Line, ReportTime } from "@/types/bidpack";
import type { TripCountFilter } from "@/lib/line-filters";

/**
 * Every threshold and toggle a filter panel offers has to actually split
 * the currently-loaded bid pack — a fixed guess like "30+ credit hours"
 * does nothing on a pack where every line already clears that (a real
 * complaint: FedEx lines commonly run well above 30). These are computed
 * fresh from the real lines instead, so a rendered chip always excludes at
 * least one line and includes at least one.
 */
export interface FilterOptions {
  /** Real, distinct "at least this many" days-off thresholds — never the pack's own minimum, since that would exclude nothing. Empty when every line has the same days off. */
  minDaysOffSteps: number[];
  /** Same idea for total credit hours. */
  minCreditHoursSteps: number[];
  /** Real, distinct "at most this many days" trip-length caps — never the pack's own longest trip, since that would exclude nothing. Empty when every trip runs the same length. */
  maxTripDaysSteps: number[];
  /** The distinct trip counts that actually occur, collapsing anything at or above 3 into one "3+" bucket. Empty when every line has the same trip count. */
  tripCountOptions: TripCountFilter[];
  /** Only the report times that actually occur — offering a report-time option nothing in the pack uses would be a no-op. Omitted (empty array) when every trip reports at the same time, since there'd be nothing to choose between. */
  availableReportTimes: ReportTime[];
  showDeadheadToggle: boolean;
  showRedEyeToggle: boolean;
  showVerifiedToggle: boolean;
  /** True only when the pack has a genuine mix of international and domestic trips — otherwise "International" or "Domestic" would be a no-op or an always-empty result. */
  showRoutingOptions: boolean;
}

const MAX_THRESHOLD_STEPS = 3;

function sampleByRank(candidates: number[], maxSteps: number): number[] {
  if (candidates.length <= maxSteps) return candidates;
  const picked = new Set<number>();
  for (let i = 1; i <= maxSteps; i++) {
    const idx = Math.round((i * (candidates.length - 1)) / maxSteps);
    picked.add(candidates[idx]);
  }
  return Array.from(picked).sort((a, b) => a - b);
}

/** Real, distinct values above the minimum — each one guarantees a "value >= threshold" filter excludes at least the lines below it. */
function pickMinThresholds(values: number[]): number[] {
  const distinct = Array.from(new Set(values)).sort((a, b) => a - b);
  return sampleByRank(distinct.slice(1), MAX_THRESHOLD_STEPS);
}

/** Real, distinct values below the maximum — each one guarantees a "value <= cap" filter excludes at least the lines above it. */
function pickMaxThresholds(values: number[]): number[] {
  const distinct = Array.from(new Set(values)).sort((a, b) => a - b);
  return sampleByRank(distinct.slice(0, -1), MAX_THRESHOLD_STEPS);
}

function computeTripCountOptions(counts: number[]): TripCountFilter[] {
  const distinct = Array.from(new Set(counts)).sort((a, b) => a - b);
  if (distinct.length <= 1) return [];
  const options: TripCountFilter[] = [];
  for (const c of distinct) {
    if (c >= 3) {
      options.push("3plus");
      break;
    }
    options.push(c as 1 | 2);
  }
  return options;
}

export function computeFilterOptions(lines: Line[]): FilterOptions {
  const daysOffValues = lines.map((l) => l.daysOff);
  const creditValues = lines.map((l) => l.totalCreditHours);
  const tripDayValues = lines.flatMap((l) => l.trips.map((t) => t.days));
  const tripCounts = lines.map((l) => l.trips.length);
  const reportTimesPresent = new Set(lines.flatMap((l) => l.trips.map((t) => t.reportTime)));
  const hasInternational = lines.some((l) => l.trips.some((t) => t.international));
  const hasDomestic = lines.some((l) => l.trips.some((t) => !t.international));

  return {
    minDaysOffSteps: pickMinThresholds(daysOffValues),
    minCreditHoursSteps: pickMinThresholds(creditValues),
    maxTripDaysSteps: pickMaxThresholds(tripDayValues),
    tripCountOptions: computeTripCountOptions(tripCounts),
    availableReportTimes:
      reportTimesPresent.size > 1
        ? (["early", "afternoon", "evening"] as ReportTime[]).filter((rt) => reportTimesPresent.has(rt))
        : [],
    showDeadheadToggle: lines.some((l) => l.trips.some((t) => t.deadheadLegs > 0)),
    showRedEyeToggle: lines.some((l) => l.trips.some(hasRedEyeLeg)),
    showVerifiedToggle: lines.some((l) => l.estimated),
    showRoutingOptions: hasInternational && hasDomestic,
  };
}
