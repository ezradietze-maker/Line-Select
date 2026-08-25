import { computeTripAnalytics } from "@/lib/trip-analytics";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * The implicit taxonomy: variables the interview never asks about directly,
 * but that real trip data can measure — the substrate the drag-and-drop
 * learner (`rank-learning.ts`) discovers weights for. Unlike the explicit
 * `PreferenceWeights` sliders, none of these have a built-in "more is
 * better" direction; a pilot might prefer more or less of any of them, and
 * finding out which is exactly what the pairwise learning is for.
 *
 * This is real, addressable data (an id + metadata per variable), not a
 * hardcoded scoring formula, so a variable promoted from a pilot's own
 * free-text explanation (see `candidate-variables.ts`) can be added here
 * without touching the learning engine itself — the engine just iterates
 * whatever's in this list.
 */

export type ValueShape = "linear" | "threshold" | "satiation";

export interface ImplicitVariable {
  id: string;
  category:
    | "circadian"
    | "dutyStructure"
    | "workload"
    | "restRecovery"
    | "layover"
    | "financial";
  label: string;
  description: string;
  valueShape: ValueShape;
}

export const IMPLICIT_VARIABLES: ImplicitVariable[] = [
  {
    id: "redEyeDeparturesPerTrip",
    category: "circadian",
    label: "Red-eye departures",
    description: "Flights departing between midnight and 5am local.",
    valueShape: "threshold",
  },
  {
    id: "backOfClockDeparturesPerTrip",
    category: "circadian",
    label: "Back-of-the-clock flying",
    description: "Departures during the circadian low, roughly 2am-6am local.",
    valueShape: "threshold",
  },
  {
    id: "distinctReportHoursPerTrip",
    category: "circadian",
    label: "Shifting report times",
    description: "How many different hours of the day this trip's duties start at — a trip that reports at a different time every day versus a consistent one.",
    valueShape: "linear",
  },
  {
    id: "timezoneCrossingLoadPerTrip",
    category: "circadian",
    label: "Timezone-crossing load",
    description: "Total timezone minutes crossed across the trip's legs — real jet-lag exposure, derived from each leg's own printed GMT/local times.",
    valueShape: "satiation",
  },
  {
    id: "avgDutyLengthHours",
    category: "dutyStructure",
    label: "Average duty day length",
    description: "Average report-to-release span across the trip's duty periods.",
    valueShape: "linear",
  },
  {
    id: "maxDutyLengthHours",
    category: "dutyStructure",
    label: "Longest single duty day",
    description: "The single longest report-to-release span in the trip.",
    valueShape: "threshold",
  },
  {
    id: "avgLegsPerDuty",
    category: "dutyStructure",
    label: "Legs per duty day",
    description: "How many flights are packed into a typical duty day.",
    valueShape: "linear",
  },
  {
    id: "dutyToBlockRatio",
    category: "dutyStructure",
    label: "Duty-to-block efficiency",
    description: "How much of the duty day is spent actually flying versus on the ground (report buffer, connections) — lower is a tighter, more efficient schedule.",
    valueShape: "linear",
  },
  {
    id: "deadheadHourRatio",
    category: "workload",
    label: "Deadhead hour share",
    description: "Share of total flying time spent as a passenger rather than operating.",
    valueShape: "threshold",
  },
  {
    id: "aircraftTypeVariety",
    category: "workload",
    label: "Aircraft/fleet variety",
    description: "Number of distinct company fleet codes flown within the trip.",
    valueShape: "linear",
  },
  {
    id: "avgTurnTimeMinutes",
    category: "workload",
    label: "Typical connection time",
    description: "Average ground time between two flights in the same duty period.",
    valueShape: "satiation",
  },
  {
    id: "maxTurnTimeMinutes",
    category: "workload",
    label: "Longest layover-free sit",
    description: "The longest single gap between flights that isn't a real overnight layover.",
    valueShape: "threshold",
  },
  {
    id: "shortRestOvernightsPerTrip",
    category: "restRecovery",
    label: "Short-rest overnights",
    description: "Overnights under 12 hours.",
    valueShape: "threshold",
  },
  {
    id: "longRestOvernightsPerTrip",
    category: "restRecovery",
    label: "Long-rest overnights",
    description: "Overnights over 24 hours.",
    valueShape: "linear",
  },
  {
    id: "avgSleepOpportunityHours",
    category: "restRecovery",
    label: "Real sleep opportunity",
    description: "Layover length minus the real hotel-pickup-to-departure ground time that follows it — a closer estimate of actual usable rest than the raw layover duration.",
    valueShape: "satiation",
  },
  {
    id: "backToBackRedEyeDutiesPerTrip",
    category: "restRecovery",
    label: "Back-to-back red-eyes",
    description: "Consecutive duty periods that both involve a red-eye departure or arrival.",
    valueShape: "threshold",
  },
  {
    id: "shortLayoverSharePerTrip",
    category: "layover",
    label: "Short-layover share",
    description: "Share of this trip's overnights that are under 12 hours — barely enough to sleep, no time to do anything else.",
    valueShape: "threshold",
  },
  {
    id: "extendedLayoverSharePerTrip",
    category: "layover",
    label: "Extended-layover share",
    description: "Share of this trip's overnights over 24 hours — long enough to feel like a mini vacation.",
    valueShape: "linear",
  },
  {
    id: "creditPerTafbHour",
    category: "financial",
    label: "Pay efficiency",
    description: "Credit hours earned per hour away from base — how well the trip pays relative to the total time it costs, independent of trip length.",
    valueShape: "linear",
  },
];

function normalize(value: number, min: number, max: number): number {
  if (max - min < 1e-9) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Raw (unnormalized) per-line values for every implicit variable, averaged across the line's schedule-verified trips — an estimated or unverified trip has nothing real to measure, so it's excluded rather than guessed. */
function computeRawLineValues(line: Line): Record<string, number | null> {
  const analytics = line.trips.filter((t) => t.schedule.length > 0).map((t) => computeTripAnalytics(t));

  if (analytics.length === 0) {
    return Object.fromEntries(IMPLICIT_VARIABLES.map((v) => [v.id, null]));
  }

  const totalLayovers = analytics.reduce(
    (sum, a) => sum + a.layoverBuckets.short + a.layoverBuckets.standard + a.layoverBuckets.extended,
    0
  );

  return {
    redEyeDeparturesPerTrip: mean(analytics.map((a) => a.redEyeDepartures)),
    backOfClockDeparturesPerTrip: mean(analytics.map((a) => a.backOfClockDepartures)),
    distinctReportHoursPerTrip: mean(analytics.map((a) => a.distinctReportHours)),
    timezoneCrossingLoadPerTrip: mean(
      analytics.map((a) => a.totalTimezoneCrossingMinutes).filter((v): v is number => v !== null)
    ),
    avgDutyLengthHours: mean(analytics.map((a) => a.dutyLengthHours?.avg).filter((v): v is number => v !== undefined)),
    maxDutyLengthHours: mean(analytics.map((a) => a.dutyLengthHours?.max).filter((v): v is number => v !== undefined)),
    avgLegsPerDuty: mean(analytics.map((a) => a.legsPerDuty?.avg).filter((v): v is number => v !== undefined)),
    dutyToBlockRatio: mean(analytics.map((a) => a.dutyToBlockRatio).filter((v): v is number => v !== null)),
    deadheadHourRatio: mean(analytics.map((a) => a.deadheadRatio).filter((v): v is number => v !== null)),
    aircraftTypeVariety: mean(analytics.map((a) => a.distinctAircraftTypes.length)),
    avgTurnTimeMinutes: mean(analytics.map((a) => a.avgTurnTimeMinutes).filter((v): v is number => v !== null)),
    maxTurnTimeMinutes: mean(analytics.map((a) => a.maxTurnTimeMinutes).filter((v): v is number => v !== null)),
    shortRestOvernightsPerTrip: mean(analytics.map((a) => a.shortRestOvernights)),
    longRestOvernightsPerTrip: mean(analytics.map((a) => a.longRestOvernights)),
    avgSleepOpportunityHours: mean(
      analytics.map((a) => a.avgSleepOpportunityHours).filter((v): v is number => v !== null)
    ),
    backToBackRedEyeDutiesPerTrip: mean(analytics.map((a) => a.backToBackRedEyeDuties)),
    shortLayoverSharePerTrip:
      totalLayovers > 0
        ? analytics.reduce((sum, a) => sum + a.layoverBuckets.short, 0) / totalLayovers
        : null,
    extendedLayoverSharePerTrip:
      totalLayovers > 0
        ? analytics.reduce((sum, a) => sum + a.layoverBuckets.extended, 0) / totalLayovers
        : null,
    creditPerTafbHour: mean(analytics.map((a) => a.creditPerTafbHour).filter((v): v is number => v !== null)),
  };
}

/** Normalized [0,1] implicit-variable values for every line in the bid pack, scaled against the bid pack's own real spread — same convention `scoring.ts` uses for the explicit dimensions. */
export function computeImplicitLineValues(bidPack: BidPack): Record<string, Record<string, number>> {
  const rawByLine = new Map(bidPack.lines.map((line) => [line.id, computeRawLineValues(line)]));

  const ranges = new Map<string, { min: number; max: number }>();
  for (const variable of IMPLICIT_VARIABLES) {
    const values = Array.from(rawByLine.values())
      .map((r) => r[variable.id])
      .filter((v): v is number => v !== null);
    ranges.set(variable.id, values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 0 });
  }

  const result: Record<string, Record<string, number>> = {};
  for (const line of bidPack.lines) {
    const raw = rawByLine.get(line.id)!;
    const normalized: Record<string, number> = {};
    for (const variable of IMPLICIT_VARIABLES) {
      const value = raw[variable.id];
      const range = ranges.get(variable.id)!;
      // Missing data (an unverified/estimated line) scores as neutral
      // midpoint rather than pulling the pilot's ranking in either
      // direction on a variable this line has no real measurement for.
      normalized[variable.id] = value === null ? 0.5 : normalize(value, range.min, range.max);
    }
    result[line.id] = normalized;
  }
  return result;
}
