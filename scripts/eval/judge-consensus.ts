/**
 * A steadier yardstick than one judge run: judge the same pilot a few more times, each with the lines in a different
 * order, and average the tiers. One judge run disagrees with another (the body-clock pilot's two runs agree at only
 * 0.78), so scoring against a single run partly rewards matching its noise. The consensus file holds each line's mean
 * tier value (A = 5 … E = 1) and how many runs graded it.
 *
 * Usage: npx tsx scripts/eval/judge-consensus.ts <persona-id> [extra-runs=2]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { judgePack, type Judgment } from "./judge";
import { PERSONAS, pilotWordsOf } from "./personas";

const V = { A: 5, B: 4, C: 3, D: 2, E: 1 } as const;

(async () => {
  process.loadEnvFile(".env.local");
  const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
  const extra = Number(process.argv[3] ?? 2);
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  const runs: Judgment[] = [JSON.parse(readFileSync(`.cache/eval/judge-${persona.id}.json`, "utf8"))];
  for (let i = 0; i < extra; i++) {
    const seed = 101 + i;
    const j = await judgePack({ pack, pilotWords: pilotWordsOf(persona), pilotContext: persona.context, cacheFile: `.cache/eval/judge-${persona.id}-c${seed}.json`, seed });
    console.log(`run ${seed}: $${j.costUsd.toFixed(2)}`);
    runs.push(j);
  }
  const lines = Object.keys(runs[0].tiers);
  const mean = Object.fromEntries(lines.map((l) => { const vs = runs.map((r) => r.tiers[l]).filter(Boolean).map((t) => V[t as keyof typeof V]); return [l, +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(3)]; }));
  writeFileSync(`.cache/eval/judge-${persona.id}-consensus.json`, JSON.stringify({ runs: runs.length, mean }, null, 2));
  console.log(`wrote consensus of ${runs.length} runs`);
})();
