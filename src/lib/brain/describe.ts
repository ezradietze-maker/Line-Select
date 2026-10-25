import { METRICS_BY_ID, type MetricDef, type MetricParams } from "@/lib/metrics/catalog";
import { criterionWeight } from "@/lib/scoring-v2/score";
import type { Criterion, CriterionShape, PilotModel } from "@/types/pilot-model";

/**
 * The pilot model said back in plain words — what the pilot will read to
 * check that we heard them right: each priority, how much it moves their
 * ranking, how it's measured on their pack, and the words it came from.
 */

const clock = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const SINGULAR: Record<string, string> = { duties: "duty", hours: "hour", days: "day", trips: "trip", legs: "leg", layovers: "layover", commutes: "commute", landings: "landing", nights: "night", flights: "flight", departures: "departure", "hub turns": "hub turn" };

/** A value in its metric's unit, the way a pilot reads it. */
export function formatValue(value: number, def: Pick<MetricDef, "unit">): string {
  if (def.unit === "minute of day") return clock(value);
  if (def.unit === "share") return `${Math.round(value * 100)}%`;
  if (def.unit.startsWith("stars")) return `${round(value)}★`;
  if (def.unit === "hours/day") return `${round(value)} credit hrs/day`;
  if (def.unit === "weighted hours")
    return value >= 0 ? `${Math.round(value)} h of layover time in places you like` : `${Math.round(-value)} h more in places you avoid than ones you like`;
  const unit = value === 1 ? (SINGULAR[def.unit] ?? def.unit) : def.unit;
  return `${round(value)} ${unit}`;
}

function describeParams(p: MetricParams | undefined): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.cities?.length) parts.push(p.cities.join(", "));
  if (p.cityScores) {
    const sorted = Object.entries(p.cityScores).sort((a, b) => b[1] - a[1]);
    const liked = sorted.filter(([, v]) => v > 0).map(([c]) => c);
    const avoided = sorted.filter(([, v]) => v < 0).reverse().map(([c]) => c);
    if (liked.length) parts.push(`best: ${liked.join(", ")}`);
    if (avoided.length) parts.push(`worst: ${avoided.join(", ")}`);
  }
  if (p.regions?.length) parts.push(p.regions.join(", "));
  if (p.dates?.length) parts.push(p.dates.join(", "));
  if (p.weekdays?.length) parts.push(p.weekdays.map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", "));
  if (p.n !== undefined) parts.push(`${p.n}+ legs`);
  if (p.minHours !== undefined || p.maxHours !== undefined) parts.push(`${p.minHours ?? 0}–${p.maxHours ?? "∞"} h`);
  if (p.frontBufferHours !== undefined) parts.push(`${p.frontBufferHours} h before flying`);
  if (p.backRestHours !== undefined) parts.push(`${p.backRestHours} h rest before heading home`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

export function describeShape(shape: CriterionShape, def: Pick<MetricDef, "unit">): string {
  const v = (n: number) => formatValue(n, def);
  switch (shape.kind) {
    case "more":
      return shape.enoughAt !== undefined ? `More is better, up to ${v(shape.enoughAt)}` : "More is better";
    case "less":
      if (shape.fineAt !== undefined && shape.worstAt !== undefined) return `Less is better: ${v(shape.fineAt)} is ideal, ${v(shape.worstAt)} or more is as bad as it gets`;
      if (shape.fineAt !== undefined) return `Less is better: ${v(shape.fineAt)} is ideal`;
      return "Less is better";
    case "target":
      return `Best around ${v(shape.ideal)} (give or take ${v(shape.tolerance)})`;
    case "range":
      if (shape.min !== undefined && shape.max !== undefined) return `Anything from ${v(shape.min)} to ${v(shape.max)} is fine`;
      return shape.min !== undefined ? `At least ${v(shape.min)}` : `No more than ${v(shape.max!)}`;
    case "perOccurrence":
      return `Each one costs about ${Math.round(shape.costEach * 100)}% of this priority`;
  }
}

export interface DescribedCriterion {
  id: string;
  label: string;
  /** Share of the ranking this priority drives, 0–100. */
  influence: number;
  tier: Criterion["tier"];
  measuredAs: string;
  shape: string;
  dealbreaker: string | null;
  quotes: string[];
  confidence: number;
}

export function describeModel(model: PilotModel): DescribedCriterion[] {
  const known = model.criteria.filter((c) => METRICS_BY_ID.has(c.metric));
  const total = known.reduce((a, c) => a + criterionWeight(c), 0) || 1;
  return known
    .map((c) => {
      const def = METRICS_BY_ID.get(c.metric)!;
      return {
        id: c.id,
        label: c.label,
        influence: Math.round((criterionWeight(c) / total) * 1000) / 10,
        tier: c.tier,
        measuredAs: `${def.label}${describeParams(c.params)}`,
        shape: describeShape(c.shape, def),
        dealbreaker: c.hardLimit
          ? c.hardLimit.op === "max" && c.hardLimit.value === 0
            ? "Dealbreaker: any at all rules a line out"
            : `Dealbreaker: ${c.hardLimit.op === "max" ? "more than" : "fewer than"} ${formatValue(c.hardLimit.value, def)} rules a line out`
          : null,
        quotes: c.evidence.map((e) => e.quote),
        confidence: c.confidence,
      };
    })
    .sort((a, b) => b.influence - a.influence);
}
