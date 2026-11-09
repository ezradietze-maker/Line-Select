import { readFileSync, writeFileSync } from "node:fs";
import { latestPersona, PERSONAS, rng, varied } from "./trade-cohort";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import { findTrades, type PilotHolding } from "@/lib/trades/match";
import type { BidPack } from "@/types/bidpack";

/**
 * How many good trades the matcher finds at a given number of pilots on the site, on real bid packs. Free: no AI calls.
 *
 * A seat is simulated bidding in seniority order: every pilot takes the best line left by their own priorities, so
 * nobody starts with a line that's easy to improve. The priorities come from the interview personas in `.cache/eval`,
 * with each pilot's weights and home varied. Then `--pilots` of the line holders are "on the site", and only they can
 * trade. These are simulated pilots: the numbers show how matches grow with size, not what real pilots would accept.
 *
 *   npx tsx scripts/eval/trade-sim.ts [--seeds 5] [--out file.md]
 */

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const SEEDS = Number(arg("seeds", "5"));
const OUT = arg("out", "");
const PACKS = arg("packs", "OCT26-MEM-MD11-FO,OCT26-MEM-B757-FO,OCT26-IND-B767-FO,OCT26-MEM-B777-FO").split(",");
const SIZES = [5, 15, 30, 100];

interface Row {
  pack: string;
  lines: number;
  pilots: number;
  /** Share of pilots with a trade in the best set, averaged over seeds. */
  served: number;
  byLength: Record<number, number>;
  swapsOnlyServed: number;
  medianGain: number;
  worstGain: number;
  medianCredit: number;
  ms: number;
  truncated: number;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

const personas = PERSONAS.map(latestPersona);
const now = Date.UTC(2026, 8, 20);
const rows: Row[] = [];

for (const name of PACKS) {
  const pack: BidPack = restoreBidPack(JSON.parse(readFileSync(`.cache/packs/${name}.json`, "utf8")));
  const prepared = prepareMetrics(pack);
  const real = pack.lines.filter((l) => !l.estimated);
  console.log(`${name}: ${real.length} real lines of ${pack.lines.length}`);
  for (const pilots of SIZES) {
    const count = Math.min(pilots, real.length);
    if (count < pilots && rows.some((r) => r.pack === name && r.pilots === count)) continue;
    const acc = { served: 0, swaps: 0, gains: [] as number[], credit: [] as number[], len: {} as Record<number, number>, ms: 0, truncated: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 7919 + pilots);
      const seat = Math.min(pack.seniorityList?.length ?? real.length, real.length);
      // Who's on the site, by place in bid order; everyone else bids too, from a smaller set of shared rankings to keep this quick.
      const order = Array.from({ length: seat }, (_, i) => i).sort(() => rand() - 0.5);
      const onSite = new Set(order.slice(0, count));
      const crowd = Array.from({ length: 24 }, () => rankLinesWithTrips(pack, varied(personas[Math.floor(rand() * personas.length)], pack.base, rand), { pack: prepared }).map((s) => s.lineId));
      const taken = new Set<string>();
      const holdings: PilotHolding[] = [];
      for (let place = 0; place < seat; place++) {
        const model = onSite.has(place) ? varied(personas[Math.floor(rand() * personas.length)], pack.base, rand) : null;
        const ranking = model ? rankLinesWithTrips(pack, model, { pack: prepared }).map((s) => s.lineId) : crowd[Math.floor(rand() * crowd.length)];
        const lineId = ranking.find((id) => !taken.has(id) && !pack.lines.find((l) => l.id === id)?.estimated);
        if (!lineId) continue;
        taken.add(lineId);
        if (model) holdings.push({ pilotId: `pilot-${place}`, model, line: pack.lines.find((l) => l.id === lineId)! });
      }
      const started = Date.now();
      const result = findTrades(pack, holdings, { now });
      acc.ms += Date.now() - started;
      if (result.truncated) acc.truncated++;
      const swapsOnly = findTrades(pack, holdings, { now, maxChain: 2 });
      acc.served += result.trades.reduce((n, t) => n + t.legs.length, 0) / holdings.length;
      acc.swaps += swapsOnly.trades.reduce((n, t) => n + t.legs.length, 0) / holdings.length;
      for (const t of result.trades) {
        acc.len[t.legs.length] = (acc.len[t.legs.length] ?? 0) + 1;
        for (const l of t.legs) {
          acc.gains.push(l.value.gain);
          acc.credit.push(l.value.creditChange);
        }
      }
    }
    const row: Row = {
      pack: name,
      lines: real.length,
      pilots: count,
      served: acc.served / SEEDS,
      byLength: Object.fromEntries(Object.entries(acc.len).map(([k, v]) => [k, v / SEEDS])),
      swapsOnlyServed: acc.swaps / SEEDS,
      medianGain: median(acc.gains),
      worstGain: acc.gains.length ? Math.min(...acc.gains) : 0,
      medianCredit: median(acc.credit),
      ms: Math.round(acc.ms / SEEDS),
      truncated: acc.truncated,
    };
    rows.push(row);
    console.log(row);
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const table = [
  "| Pack | Pilots on site | Get a trade | Swaps only | Trades found (by pilots in each) | Median gain | Smallest gain | Time |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => {
    const lengths = Object.entries(r.byLength).sort().map(([k, v]) => `${k}: ${v.toFixed(1)}`).join(", ") || "none";
    return `| ${r.pack.replace("OCT26-", "")} | ${r.pilots} | ${pct(r.served)} | ${pct(r.swapsOnlyServed)} | ${lengths} | +${r.medianGain.toFixed(1)} | +${r.worstGain.toFixed(1)} | ${(r.ms / 1000).toFixed(1)}s${r.truncated ? " (search limit hit)" : ""} |`;
  }),
].join("\n");
console.log(`\n${table}`);
if (OUT) writeFileSync(OUT, `${table}\n`);
