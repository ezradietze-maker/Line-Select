/**
 * Does fitting weights to a few line choices help or hurt, on a pilot's real verdicts? The verdicts become line-vs-line
 * choices (a "top" line over a "never" line is an easy call; top over fine, or fine over never, a close one). For many
 * random splits, the model is fitted on a few choices and scored on all the others it never saw — with and without the
 * cap that limits how far a handful of choices can move a weight. No API calls.
 *
 * Usage: npx tsx scripts/eval/fit-holdout.ts <persona-id> <sim-tag>   (the sim run supplies the starting model)
 */
import { readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { prepareMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { LineChoice, PilotModel } from "@/types/pilot-model";
import { PERSONAS } from "./personas";

const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
const run = JSON.parse(readFileSync(`.cache/eval/sim/${persona.id}-${process.argv[3]}.json`, "utf8"));
const start: PilotModel = run.preFit ?? run.model;
const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
const pm = prepareMetrics(pack);
const labels = persona.lineLabels!;
const RANK = { top: 3, fine: 2, never: 1 } as const;
const lines = Object.keys(labels);
const all: LineChoice[] = [];
for (const a of lines)
  for (const b of lines) {
    const d = RANK[labels[a]] - RANK[labels[b]];
    if (d > 0) all.push({ preferred: a, other: b, strength: d === 2 ? "strongly" : "slightly" });
  }

const agree = (m: PilotModel, choices: LineChoice[]) => {
  const s = new Map(scorePackV2(pack, m, { pack: pm }).map((x) => [x.lineNumber, x.score]));
  return choices.filter((c) => (s.get(c.preferred) ?? 0) > (s.get(c.other) ?? 0)).length / choices.length;
};

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
console.log(`${persona.id}: ${all.length} choices from the pilot's verdicts; starting model agrees on ${(100 * agree(start, all)).toFixed(1)}%`);
for (const n of [2, 4, 8, 16]) {
  let unfitted = 0;
  let fitted = 0;
  const trials = 60;
  for (let t = 0; t < trials; t++) {
    const shuffled = [...all].sort(() => rand() - 0.5);
    const train = shuffled.slice(0, n);
    const test = shuffled.slice(n);
    unfitted += agree(start, test);
    fitted += agree(fitWeightsToChoices(pack, start, train, pm).model, test);
  }
  console.log(`  fit on ${String(n).padStart(2)} choices → held-out agreement: no fit ${(100 * unfitted / trials).toFixed(1)}%, fitted ${(100 * fitted / trials).toFixed(1)}%`);
}
