import { prepareMetrics } from "@/lib/metrics/compute";
import type { CriterionResult, V2LineScore } from "@/lib/scoring-v2/score";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * What a trade is worth to one pilot: their whole month scored with the trip swapped, on the same score their rankings
 * use. A trip's worth depends on what's around it (the days-off block it breaks up, the commute it adds), so it's the
 * line that's judged, not the trip alone.
 */

const blockOf = (t: Trip) => t.schedule.reduce((sum, d) => sum + (d.totals?.blockHours ?? 0), 0);

/** The calendar days a trip touches, from the start of the bid period. */
function daysOf(t: Trip): number[] {
  return t.startDayIndex === null ? [] : Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i);
}

/** `line` with `give` taken out and `take` put in, its totals moved by the difference. Neither trip runs past the month (`isTradeable`). */
export function swappedLine(line: Line, give: Trip, take: Trip, id: string): Line {
  const trips = [...line.trips.filter((t) => t !== give), take].sort((a, b) => (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
  const held = (ts: Trip[]) => new Set(ts.flatMap(daysOf));
  const before = held(line.trips);
  const after = held(trips);
  const off = new Set(line.gridOffDays ?? []);
  for (const d of before) if (!after.has(d)) off.add(d);
  for (const d of after) off.delete(d);
  const add = (total: number | undefined, a: number | undefined, b: number | undefined) => (total === undefined ? undefined : total + (a ?? 0) - (b ?? 0));
  return {
    ...line,
    id,
    trips,
    daysOff: line.daysOff + before.size - after.size,
    totalCreditHours: line.totalCreditHours + take.creditHours - give.creditHours,
    totalTafbHours: line.totalTafbHours + take.tafbHours - give.tafbHours,
    totalBlockHours: add(line.totalBlockHours, blockOf(take), blockOf(give)),
    totalLandings: line.totalLandings + take.landings - give.landings,
    totalDepartures: line.totalDepartures + take.departures - give.departures,
    totalDutyPeriods: add(line.totalDutyPeriods, take.dutyPeriods, give.dutyPeriods),
    ...(line.gridOffDays ? { gridOffDays: [...off].sort((a, b) => a - b) } : {}),
  };
}

/** One priority a trade moves, as a pilot would read it. */
export interface TradeReason {
  label: string;
  from: number | null;
  to: number | null;
  unit: string;
  better: boolean;
}

export interface SwapValue {
  give: Trip;
  take: Trip;
  before: number;
  after: number;
  /** After less before: above zero, the pilot's month is better by their own priorities. */
  gain: number;
  creditChange: number;
  daysOffChange: number;
  /** What moves most, best first; the last is what it costs them, when anything does. */
  reasons: TradeReason[];
}

function reasonsFor(before: V2LineScore, after: V2LineScore): TradeReason[] {
  const moved = after.results.map((r: CriterionResult, i: number) => {
    const was = before.results[i];
    return { r, was, change: (r.utility - was.utility) * r.weight };
  });
  const SMALL = 0.01;
  const up = moved.filter((m) => m.change > SMALL).sort((a, b) => b.change - a.change).slice(0, 2);
  const down = moved.filter((m) => m.change < -SMALL).sort((a, b) => a.change - b.change).slice(0, 1);
  return [...up, ...down].map(({ r, was, change }) => ({ label: r.label, from: was.value, to: r.value, unit: r.unit, better: change > 0 }));
}

/** Scores each swap against the pilot's current line. Measured on the pack's own scale, so the swaps don't move it. */
export function valueSwaps(pack: BidPack, line: Line, model: PilotModel, swaps: readonly { give: Trip; take: Trip }[]): SwapValue[] {
  if (swaps.length === 0) return [];
  const currentId = "__held__";
  const extras = swaps.map((s, i) => swappedLine(line, s.give, s.take, `__swap-${i}__`));
  const withSwaps: BidPack = { ...pack, lines: [...pack.lines, { ...line, id: currentId }, ...extras] };
  const scores = rankLinesWithTrips(withSwaps, model, { pack: prepareMetrics(withSwaps), referenceLines: pack.lines.length });
  const byId = new Map(scores.map((s) => [s.lineId, s]));
  const current = byId.get(currentId)!;
  return swaps.map((s, i) => {
    const after = byId.get(`__swap-${i}__`)!;
    const swapped = extras[i];
    return {
      give: s.give,
      take: s.take,
      before: current.score,
      after: after.score,
      gain: Math.round((after.score - current.score) * 10) / 10,
      creditChange: Math.round((swapped.totalCreditHours - line.totalCreditHours) * 100) / 100,
      daysOffChange: swapped.daysOff - line.daysOff,
      reasons: reasonsFor(current, after),
    };
  });
}
