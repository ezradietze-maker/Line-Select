import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { METRICS_BY_ID, type Aggregation, type LineContext, type MetricDef, type MetricParams } from "@/lib/metrics/catalog";
import { computeTripFacts, type TripFacts } from "@/lib/metrics/trip-facts";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * Evaluating the metric library against a bid pack. Trip facts are computed
 * once per trip and shared by every measurement; each measurement can be
 * asked for with the pilot's own parameters.
 */

export interface PackMetrics {
  ctx: LineContext;
  factsByLine: Map<string, TripFacts[]>;
}

export function prepareMetrics(bidPack: BidPack): PackMetrics {
  const factsByLine = new Map<string, TripFacts[]>();
  const memo = new Map<string, TripFacts>();
  for (const line of bidPack.lines) {
    factsByLine.set(
      line.id,
      line.trips.map((t) => {
        // The same pairing appears in many lines with the same schedule — compute its facts once.
        const key = `${t.id}|${t.schedule.length}`;
        let f = memo.get(key);
        if (!f || f.trip !== t) {
          f = computeTripFacts(t);
          memo.set(key, f);
        }
        return f;
      })
    );
  }
  return {
    ctx: {
      bidPeriodStart: bidPack.bidPeriodStart,
      bidPeriodDays: bidPack.bidPeriodDays,
      homeBaseOffsetMinutes: computeHomeBaseOffsetMinutes(bidPack),
      base: bidPack.base,
    },
    factsByLine,
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
export function measureLine(def: MetricDef, line: Line, pack: PackMetrics, params: MetricParams = {}): number | null {
  const p = { ...def.defaults, ...params, base: pack.ctx.base };
  const trips = pack.factsByLine.get(line.id) ?? [];
  if (def.line) return def.line(line, trips, pack.ctx, p);
  if (!def.trip) return null;
  if (line.estimated) return null;
  const scheduled = trips.filter((t) => t.trip.schedule.length > 0);
  if (scheduled.length === 0 && line.trips.length > 0) return null;
  const values = scheduled.map((t) => def.trip!.measure(t, p)).filter((v): v is number => v !== null && Number.isFinite(v));
  return aggregate(values, def.trip.aggregate);
}

export function measure(metricId: string, line: Line, pack: PackMetrics, params: MetricParams = {}): number | null {
  const def = METRICS_BY_ID.get(metricId);
  return def ? measureLine(def, line, pack, params) : null;
}
