/**
 * How much the judge agrees with itself: judge the same pilot again with the
 * lines in a different order and compare. That agreement is the ceiling —
 * no ranking can be expected to match the judge better than it matches itself.
 *
 * Usage: npx tsx scripts/eval/judge-consistency.ts <persona-id> [seed]
 */
import { readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { judgePack } from "./judge";
import { PERSONAS } from "./personas";

const V = { A: 5, B: 4, C: 3, D: 2, E: 1 } as const;

(async () => {
  process.loadEnvFile(".env.local");
  const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
  const seed = Number(process.argv[3] ?? 13);
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  const a = await judgePack({ pack, pilotWords: persona.story, pilotContext: persona.context, cacheFile: `.cache/eval/judge-${persona.id}.json` });
  const b = await judgePack({ pack, pilotWords: persona.story, pilotContext: persona.context, cacheFile: `.cache/eval/judge-${persona.id}-s${seed}.json`, seed });
  const lines = Object.keys(a.tiers).filter((l) => b.tiers[l]);
  const xs = lines.map((l) => V[a.tiers[l]]);
  const ys = lines.map((l) => V[b.tiers[l]]);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs), my = mean(ys);
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const r = cov / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  const exact = lines.filter((l) => a.tiers[l] === b.tiers[l]).length;
  const within1 = lines.filter((l) => Math.abs(V[a.tiers[l]] - V[b.tiers[l]]) <= 1).length;
  const topA = new Set(a.top.slice(0, 10).map((t) => t.line));
  console.log({ cost: b.costUsd.toFixed(2), tierCorrelation: r.toFixed(3), exactTier: `${exact}/${lines.length}`, withinOneTier: `${within1}/${lines.length}`, top10Overlap: b.top.slice(0, 10).filter((t) => topA.has(t.line)).length });
  console.log("run 2 top:", b.top.map((t) => t.line).join(", "));
})();
