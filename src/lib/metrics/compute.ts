import { monthLine } from "@/lib/bid-month";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { METRICS_BY_ID, type Aggregation, type LineContext, type MetricDef, type MetricParams } from "@/lib/metrics/catalog";
import { computeTripFacts, type TripFacts } from "@/lib/metrics/trip-facts";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * Evaluating the metric library against a bid pack. Trip facts are computed
 * once per trip and shared by every measurement; each measurement can be
 * asked for with the pilot's own parameters.
 *
 * A line is measured on its bid month: its trips cut at the month's end (`lib/bid-month.ts`), what runs into the next
 * month left out — every count and total is the month's. What a trip is like — its length, its worst duty, the rate it
 * pays, a run of nights — is the whole trip's: the pilot flies it whole, and a cut one would read shorter and easier
 * than it is. A trip is scored whole too.
 */

export interface PackMetrics {
  ctx: LineContext;
  /** Each line as its bid month (`monthLine`), and its trips' facts as flown in it. */
  monthLines: Map<string, Line>;
  factsByLine: Map<string, TripFacts[]>;
  /** Each line's trips' facts whole, carry-over included — for scoring trips. */
  tripFactsByLine: Map<string, TripFacts[]>;
}

export function prepareMetrics(bidPack: BidPack): PackMetrics {
  const monthLines = new Map<string, Line>();
  const factsByLine = new Map<string, TripFacts[]>();
  const tripFactsByLine = new Map<string, TripFacts[]>();
  const memo = new Map<string, TripFacts>();
  const factsOf = (t: Line["trips"][number]) => {
    // The same pairing appears in many lines with the same schedule — compute its facts once.
    const key = `${t.id}|${t.schedule.length}|${t.carriesIntoNextMonth ? t.creditHours : ""}`;
    let f = memo.get(key);
    if (!f || f.trip !== t) {
      f = computeTripFacts(t);
      memo.set(key, f);
    }
    return f;
  };
  for (const line of bidPack.lines) {
    const month = monthLine(line, bidPack);
    monthLines.set(line.id, month);
    const whole = line.trips.map(factsOf);
    tripFactsByLine.set(line.id, whole);
    factsByLine.set(line.id, month === line ? whole : month.trips.map(factsOf));
  }
  return {
    ctx: {
      bidPeriodStart: bidPack.bidPeriodStart,
      bidPeriodDays: bidPack.bidPeriodDays,
      homeBaseOffsetMinutes: computeHomeBaseOffsetMinutes(bidPack),
      base: bidPack.base,
    },
    monthLines,
    factsByLine,
    tripFactsByLine,
  };
}

function aggregate(values: number[], how: Aggregation): number | null {
  if (values.length === 0) return how === "sum" ? 0 : null;
  switch (how) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
  }
}

/** One measurement for one line, in its real unit — null when the pack has nothing real to measure it from (an estimated line, a trip with no schedule). */
export function measureLine(def: MetricDef, asPrinted: Line, pack: PackMetrics, params: MetricParams = {}): number | null {
  const p = { ...def.defaults, ...params, base: pack.ctx.base, bidPeriodStart: pack.ctx.bidPeriodStart };
  const line = pack.monthLines.get(asPrinted.id) ?? asPrinted;
  const trips = pack.factsByLine.get(line.id) ?? [];
  const whole = pack.tripFactsByLine.get(line.id) ?? trips;
  if (def.line) return def.line(line, trips, pack.ctx, p, whole);
  if (!def.trip) return null;
  if (line.estimated) return null;
  // A sum over the trips is the month's; a mean, longest or worst is what the trips are like, whole.
  const each = def.trip.aggregate === "sum" ? trips : whole;
  const scheduled = each.filter((t) => t.trip.schedule.length > 0);
  if (scheduled.length === 0 && line.trips.length > 0) return null;
  const values = scheduled.map((t) => def.trip!.measure(t, p)).filter((v): v is number => v !== null && Number.isFinite(v));
  return aggregate(values, def.trip.aggregate);
}

export function measure(metricId: string, line: Line, pack: PackMetrics, params: MetricParams = {}): number | null {
  const def = METRICS_BY_ID.get(metricId);
  return def ? measureLine(def, line, pack, params) : null;
}
