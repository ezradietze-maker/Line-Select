import { citySearchName } from "@/lib/hotels/airport-names";
import { METRICS, type MetricDef } from "@/lib/metrics/catalog";
import { measureLine, prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import type { BidPack } from "@/types/bidpack";

/**
 * What the brain knows about this pilot's bid pack before it reads a word
 * they say: every metric it can bind a priority to, with what that metric
 * actually looks like across this pack's lines (so "less flying" gets an
 * anchor in real hours, not a guess), and every city the pack really goes
 * to, with how much time is spent there.
 */

export interface MetricSpread {
  min: number;
  median: number;
  max: number;
}

function spreadOf(def: MetricDef, bidPack: BidPack, pack: PackMetrics): MetricSpread | null {
  const vs = bidPack.lines.map((l) => measureLine(def, l, pack)).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (vs.length === 0) return null;
  return { min: vs[0], median: vs[Math.floor(vs.length / 2)], max: vs[vs.length - 1] };
}

const fmt = (n: number) => (Math.abs(n) >= 100 || Number.isInteger(n) ? n.toFixed(0) : n.toFixed(Math.abs(n) < 1 ? 2 : 1));

export interface PackCity {
  code: string;
  name: string;
  region: string;
  layovers: number;
  totalHours: number;
  /** Lines with at least one layover there. */
  lines: number;
}

export function packCities(bidPack: BidPack, pack: PackMetrics = prepareMetrics(bidPack)): PackCity[] {
  const by = new Map<string, PackCity & { lineIds: Set<string> }>();
  for (const line of bidPack.lines) {
    for (const f of pack.factsByLine.get(line.id) ?? []) {
      for (const l of f.layovers) {
        const c = by.get(l.city) ?? { code: l.city, name: citySearchName(l.city), region: l.region, layovers: 0, totalHours: 0, lines: 0, lineIds: new Set<string>() };
        c.layovers++;
        c.totalHours += l.hours;
        c.lineIds.add(line.id);
        by.set(l.city, c);
      }
    }
  }
  return [...by.values()].map(({ lineIds, ...c }) => ({ ...c, lines: lineIds.size })).sort((a, b) => b.layovers - a.layovers);
}

/** The pack and the metric menu, as text for the brain's prompt. Identical for every turn of an interview, so it's cached. */
export function buildPackBrief(bidPack: BidPack, pack: PackMetrics = prepareMetrics(bidPack)): string {
  const cities = packCities(bidPack, pack);
  const menu = METRICS.map((def) => {
    const s = spreadOf(def, bidPack, pack);
    const params = def.params?.length ? ` · params: ${def.params.join(", ")}${def.defaults && Object.keys(def.defaults).length ? ` (defaults ${JSON.stringify(def.defaults)})` : ""}` : "";
    const range = s ? ` · this pack: ${fmt(s.min)} – ${fmt(s.median)} (median) – ${fmt(s.max)}` : "";
    return `- ${def.id} [${def.unit}] — ${def.label}. ${def.description}${params}${range}`;
  }).join("\n");
  const cityTable = cities.map((c) => `- ${c.code} ${c.name} (${c.region}): ${c.layovers} layovers, ${Math.round(c.totalHours)}h total, on ${c.lines} of ${bidPack.lines.length} lines`).join("\n");
  return [
    `BID PACK: ${bidPack.month} · base ${bidPack.base} · ${bidPack.aircraft} ${bidPack.seat} · ${bidPack.lines.length} lines · ${bidPack.bidPeriodDays}-day bid period starting ${bidPack.bidPeriodStart ?? "?"}.`,
    `METRICS YOU CAN BIND A PRIORITY TO (ranges are across this pack's lines, with default params; "minute of day" is minutes after local midnight):\n${menu}`,
    `LAYOVER CITIES IN THIS PACK (most layovers first):\n${cityTable}`,
  ].join("\n\n");
}
