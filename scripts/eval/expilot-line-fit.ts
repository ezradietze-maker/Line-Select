import { readFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitWeightsToChoices, type LineFitOptions } from "@/lib/brain/fit-choices";
import { prepareMetrics } from "@/lib/metrics/compute";
import { migrateProfile } from "@/lib/profile-migration";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { LineChoice, PilotModel } from "@/types/pilot-model";

/**
 * The line-choice fit, tested on the ex-pilot's own sort: a few of the comparisons his sort makes are handed to the fit
 * as if he'd made them in the interview, and the rest are held out — does the fit get the held-out ones right more
 * often than his model did? Many random draws, on each of his readings. Free (no AI calls); his data stays private.
 *
 *   npx tsx scripts/eval/expilot-line-fit.ts [choices per draw]
 */

const DIR = "private/ex-pilot";
const pack = restoreBidPack(JSON.parse(readFileSync(`${DIR}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`, "utf8")));
const pm = prepareMetrics(pack);
const ans = JSON.parse(readFileSync(`${DIR}/benchmark-oct26/answers.json`, "utf8"));
const piles: string[][] = [ans.piles.top, ans.piles.fine, ans.piles.onlyIfHadTo, ans.piles.bottom];
/** Every comparison his sort makes, "easily" when two piles apart. */
const pairs: LineChoice[] = [];
piles.forEach((u, i) => piles.slice(i + 1).forEach((l, k) => u.forEach((a) => l.forEach((b) => pairs.push({ preferred: a, other: b, strength: k >= 1 ? "strongly" : "slightly" })))));

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

export function heldOut(base: PilotModel, k: number, draws: number, options?: LineFitOptions): { before: number; after: number } {
  let before = 0;
  let after = 0;
  let n = 0;
  const s0 = new Map(scorePackV2(pack, base, { pack: pm }).map((x) => [x.lineNumber, x.score]));
  for (let d = 0; d < draws; d++) {
    const r = rng(1000 + d);
    const shuffled = [...pairs].sort(() => r() - 0.5);
    const train = shuffled.slice(0, k);
    const test = shuffled.slice(k).filter((c) => !train.some((t) => t.preferred === c.preferred || t.other === c.other || t.preferred === c.other || t.other === c.preferred));
    const fit = fitWeightsToChoices(pack, base, train, pm, options).model;
    const s1 = new Map(scorePackV2(pack, fit, { pack: pm }).map((x) => [x.lineNumber, x.score]));
    for (const c of test) {
      n++;
      if (s0.get(c.preferred)! > s0.get(c.other)!) before++;
      if (s1.get(c.preferred)! > s1.get(c.other)!) after++;
    }
  }
  return { before: (100 * before) / n, after: (100 * after) / n };
}

export const READINGS = ["profile-oct21", "replay-v17-e", "replay-v17-f", "replay-v17-g", "replay-v17-h"].map((f) => {
  const p = migrateProfile(JSON.parse(readFileSync(`${DIR}/benchmark-oct26/${f}.json`, "utf8")));
  return { name: f, model: applyCityRatings(p.brainInterview!.reviewedModel!, p.cityRatings) as PilotModel };
});

if (process.argv[1]?.endsWith("expilot-line-fit.ts")) {
  const k = Number(process.argv[2] ?? 3);
  for (const r of READINGS) {
    const x = heldOut(r.model, k, 40);
    console.log(`${r.name.padEnd(14)} ${k} choices: held-out comparisons ${x.before.toFixed(1)}% → ${x.after.toFixed(1)}%`);
  }
}
