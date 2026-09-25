import { lineDutyPeriods } from "@/lib/duty-periods";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { lineStandbyDays } from "@/lib/standby";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * What a pilot could like or dislike about a line, reduced to a handful of
 * numbers read straight off the bid pack. The forecast models every pilot's
 * taste as weights on these, so it can rank the whole pack for a pilot it
 * knows nothing about. Each column is standardized across the pack (mean 0,
 * spread 1), so a weight means "how much this pilot cares about a typical
 * step up or down in this thing" no matter what its raw unit is.
 */
export const FEATURE_NAMES = [
  "daysOff",
  "credit",
  "dutyPeriods",
  "landings",
  "international",
  "reportLean",
  "nightFlying",
  "standby",
  "deadhead",
  "tripLength",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export const FEATURE_COUNT = FEATURE_NAMES.length;

export interface LineFeatures {
  lineIds: string[];
  lineNumbers: string[];
  /** Row-major, `lines × FEATURE_COUNT`, each column standardized. */
  values: Float64Array;
  lineCount: number;
}

const REPORT_VALUE = { early: 0, afternoon: 0.5, evening: 1 } as const;

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rawFeatures(line: Line, implicit: Record<string, number> | undefined): number[] {
  const trips = line.trips;
  const share = (pick: (t: (typeof trips)[number]) => number) => mean(trips.map(pick));
  return [
    line.daysOff,
    line.totalCreditHours,
    lineDutyPeriods(line),
    line.totalLandings,
    share((t) => (t.international ? 1 : 0)),
    share((t) => REPORT_VALUE[t.reportTime]),
    ((implicit?.redEyeDeparturesPerTrip ?? 0.5) + (implicit?.backOfClockDeparturesPerTrip ?? 0.5)) / 2,
    lineStandbyDays(line),
    share((t) => t.deadheadLegs),
    share((t) => t.days),
  ];
}

/** Builds the standardized feature matrix for every line in a bid pack. */
export function buildLineFeatures(bidPack: BidPack, implicitValuesByLine?: Record<string, Record<string, number>>): LineFeatures {
  const implicit = implicitValuesByLine ?? computeImplicitLineValues(bidPack);
  const lines = bidPack.lines;
  const raw = lines.map((l) => rawFeatures(l, implicit[l.id]));
  const values = new Float64Array(lines.length * FEATURE_COUNT);

  for (let k = 0; k < FEATURE_COUNT; k++) {
    const column = raw.map((r) => r[k]);
    const m = mean(column);
    const sd = Math.sqrt(mean(column.map((x) => (x - m) ** 2)));
    for (let i = 0; i < lines.length; i++) values[i * FEATURE_COUNT + k] = sd < 1e-9 ? 0 : (column[i] - m) / sd;
  }

  return { lineIds: lines.map((l) => l.id), lineNumbers: lines.map((l) => l.lineNumber), values, lineCount: lines.length };
}
