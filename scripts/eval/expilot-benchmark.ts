import { existsSync, readFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitTripWeights } from "@/lib/brain/fit-choices";
import { modelToDepartures } from "@/lib/brain/model-upgrade";
import { migrateProfile } from "@/lib/profile-migration";
import { type V2LineScore } from "@/lib/scoring-v2/score";
import { rankLinesWithTrips, tripKey } from "@/lib/scoring-v2/trip-score";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The real-pilot benchmark: how closely a model's ranking of a pack matches the ex-pilot's own sort of a sample of its
 * lines. He sorts the sample into four piles (top · fine · only if I had to · bottom) and orders his top pile; every
 * pair of lines his sort puts in an order is a pair the app has to get the same way round.
 *
 * Free to run (no AI calls), so it runs after every change to metrics, weights or the brain. His sort, his pack and his
 * model quote him and say where he lives, so they stay in the gitignored private folder; this script only reads them.
 *
 *   npx tsx scripts/eval/expilot-benchmark.ts [--pack <pack.json>] [--model <profile-or-model.json>] [--answers <answers.json>]
 *
 * `--model` takes a saved profile or a bare PilotModel. A profile is read the way the app loads it (saved models move
 * onto departures) and scored on the model he confirmed with his own city grades applied; a bare model is moved onto
 * departures the same way. Without `--answers`, only the line choices he made in the interview are checked.
 * `--trip-picks` takes his five real trip picks (Oct 21) as his trip answers, the way trip grades would come in, so his
 * lines are ranked with them (`rankLinesWithTrips`).
 */

const DIR = "private/ex-pilot";
const DEFAULTS = {
  pack: `${DIR}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`,
  // His saved profile with the city step put right (on the day, a grade meant for Newark landed on El Paso), and the
  // cities he graded later, in his Oct 21 answers.
  model: `${DIR}/benchmark-oct26/profile-oct21.json`,
  answers: `${DIR}/benchmark-oct26/answers.json`,
};

/** His sort. Pile order is best first; only `top` is ordered within itself. */
interface Answers {
  piles: { top: string[]; fine: string[]; onlyIfHadTo: string[]; bottom: string[] };
  /** Line choices from the interview itself: [the line he bid higher, the other one]. */
  choices?: [string, string][];
  /** His whole sample in his order, best first, when he ordered all of it. */
  fullOrder?: string[];
  /** His trip picks, by pairing number: [the trip he picked, the other one], by pair. */
  tripPicks?: Record<string, [string, string]>;
}

/** The two line choices he made in the Oct 15 interview, both "easily". */
const INTERVIEW_CHOICES: [string, string][] = [
  ["1010", "1016"],
  ["1033", "1039"],
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadModel(path: string): PilotModel {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw?.criteria)) return modelToDepartures(raw as PilotModel);
  const profile = migrateProfile(raw);
  const model = profile.brainInterview?.reviewedModel ?? profile.pilotModel;
  if (!Array.isArray(model?.criteria)) throw new Error(`${path} holds no pilot model.`);
  return applyCityRatings(model, profile.cityRatings);
}

/** Every ordered pair his sort implies: across piles, and within his ordered top pile. [better, worse]. */
function pairsFromSort(a: Answers): [string, string][] {
  const piles = [a.piles.top, a.piles.fine, a.piles.onlyIfHadTo, a.piles.bottom];
  const pairs: [string, string][] = [];
  piles.forEach((upper, i) => piles.slice(i + 1).forEach((lower) => upper.forEach((u) => lower.forEach((l) => pairs.push([u, l])))));
  a.piles.top.forEach((u, i) => a.piles.top.slice(i + 1).forEach((l) => pairs.push([u, l])));
  return pairs;
}

const fmt = (v: number | null) => (v === null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The criteria that most separate two lines, as "label: a vs b (points)". */
function why(a: V2LineScore, b: V2LineScore): string {
  return a.results
    .map((r) => {
      const o = b.results.find((x) => x.criterionId === r.criterionId);
      return { r, o, d: r.contribution - (o?.contribution ?? 0) };
    })
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 3)
    .map(({ r, o, d }) => `${r.label}: ${fmt(r.value)} vs ${fmt(o?.value ?? null)} (${d >= 0 ? "+" : ""}${d.toFixed(1)})`)
    .join(" | ");
}

(() => {
  const packPath = arg("pack") ?? DEFAULTS.pack;
  const modelPath = arg("model") ?? DEFAULTS.model;
  const answersPath = arg("answers") ?? DEFAULTS.answers;
  for (const p of [packPath, modelPath]) if (!existsSync(p)) throw new Error(`${p} isn't on this machine (it lives in the private folder).`);

  const pack = restoreBidPack(JSON.parse(readFileSync(packPath, "utf8")));
  const answers: Answers | null = existsSync(answersPath) ? JSON.parse(readFileSync(answersPath, "utf8")) : null;
  let model = loadModel(modelPath);
  if (process.argv.includes("--trip-picks") && answers?.tripPicks) {
    // His words on each pair: C was "a somewhat tough call", the rest clear.
    const trip = (n: string) => pack.lines.flatMap((l) => l.trips).find((t) => t.pairingNumber === n)!;
    const picks = Object.entries(answers.tripPicks).map(([pair, [a, b]]) => ({ preferred: tripKey(trip(a)), other: tripKey(trip(b)), strength: pair === "C" ? ("slightly" as const) : ("strongly" as const) }));
    model = { ...model, tripWeights: fitTripWeights(pack, model, picks).tripWeights };
  }
  const ranked = rankLinesWithTrips(pack, model);
  const byLine = new Map(ranked.map((r, i) => [r.lineNumber, { r, rank: i + 1 }]));
  const get = (n: string) => {
    const x = byLine.get(n);
    if (!x) throw new Error(`Line ${n} isn't in ${pack.id}.`);
    return x;
  };
  const check = (pairs: [string, string][]) => pairs.map(([better, worse]) => ({ better: get(better), worse: get(worse), agrees: get(better).r.score > get(worse).r.score }));

  console.log(`${pack.id} · ${ranked.length} lines · model from ${modelPath}\n`);

  console.log("Interview line choices");
  for (const c of check([...INTERVIEW_CHOICES, ...(answers?.choices ?? [])])) {
    console.log(`  ${c.agrees ? "agrees  " : "DISAGREES"} ${c.better.r.lineNumber} (#${c.better.rank}, ${c.better.r.score}) over ${c.worse.r.lineNumber} (#${c.worse.rank}, ${c.worse.r.score})`);
    console.log(`            ${why(c.better.r, c.worse.r)}`);
  }

  if (!answers) {
    console.log(`\nNo sort yet at ${answersPath} — only the interview choices were checked.`);
    return;
  }

  const results = check(pairsFromSort(answers));
  const agree = results.filter((c) => c.agrees).length;
  console.log(`\nHis sort: ${agree} of ${results.length} pairs the same way round (${((100 * agree) / results.length).toFixed(1)}%)`);

  if (answers.fullOrder?.length) {
    // Every pair of his full order, not just across piles — and how far each line sits from where he put it.
    const order = answers.fullOrder;
    const full = check(order.flatMap((u, i) => order.slice(i + 1).map((l) => [u, l] as [string, string])));
    const fullAgree = full.filter((c) => c.agrees).length;
    const byApp = [...order].sort((a, b) => get(a).rank - get(b).rank);
    const n = order.length;
    const d2 = order.reduce((s, line, i) => s + (byApp.indexOf(line) - i) ** 2, 0);
    const rho = 1 - (6 * d2) / (n * (n * n - 1));
    console.log(`His full order: ${fullAgree} of ${full.length} pairs the same way round (${((100 * fullAgree) / full.length).toFixed(1)}%), rank correlation ${rho.toFixed(2)}`);
    console.log(`  His place → the app's: ${order.map((line, i) => `${line} ${i + 1}→${byApp.indexOf(line) + 1}`).join(" · ")}`);
  }

  const sample = [...answers.piles.top, ...answers.piles.fine, ...answers.piles.onlyIfHadTo, ...answers.piles.bottom];
  const appOrder = [...sample].sort((a, b) => get(a).rank - get(b).rank);
  console.log(`His top pile, by the app's rank among his ${sample.length}: ${answers.piles.top.map((n) => `${n} → ${appOrder.indexOf(n) + 1}`).join(", ")}`);

  const misses = results
    .filter((c) => !c.agrees)
    .sort((a, b) => b.worse.r.score - b.better.r.score - (a.worse.r.score - a.better.r.score))
    .slice(0, 5);
  if (misses.length) console.log("\nBiggest misses (he puts the first line higher):");
  for (const m of misses) {
    console.log(`  ${m.better.r.lineNumber} (${m.better.r.score}) below ${m.worse.r.lineNumber} (${m.worse.r.score})`);
    console.log(`     ${why(m.better.r, m.worse.r)}`);
  }
})();
