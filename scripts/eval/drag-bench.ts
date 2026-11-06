/**
 * The swap bench: what a pilot's swaps on their results teach the brain, end to end through the app's own code (the
 * placements that keep a swap where the pilot put it, the choices a swap makes, and the fit). Free — no AI calls.
 *
 * Synthetic pilots: for each saved interview reading, made-up pilots whose true weights are the reading's, each scaled
 * by e^(N(0, 0.6)) — the interview named the right things but weighed them wrong, which is what swaps should fix. The
 * pilot looks at the top 12, swaps the highest line that's out of place (judged on true scores plus noise, τ points),
 * and the brain refits. Scored on pairs among the pilot's true top 30 that never appeared on screen: does what it learned
 * carry to lines the pilot never touched? Reported as mean ± standard error over pilots, and the paired difference.
 *
 * The ex-pilot: his real order of 20 lines, half shown and swapped, the other half held out.
 *
 *   npx tsx scripts/eval/drag-bench.ts [synthetic|expilot|both] [swaps=6] [tau=2] [pilots per reading=10] ['{"swap":{…}}']
 *   EVAL_ROOT=<main checkout> when running from a worktree (the saved runs and packs live there).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expandBidPack, restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { choicesFromDrag, choicesFromSwap } from "@/lib/brain/profile-model";
import { learnFromChoices, type LearnerSettings } from "@/lib/brain/reorder-learner";
import { applyPlacements, placementFromDrag, type Placement } from "@/lib/line-placements";
import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { migrateProfile } from "@/lib/profile-migration";
import { rankLinesWithTrips, tripKey } from "@/lib/scoring-v2/trip-score";
import { fitTripWeights } from "@/lib/brain/fit-choices";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel, TripChoice } from "@/types/pilot-model";
import { PERSONAS } from "./personas";

const ROOT = process.env.EVAL_ROOT ?? ".";
const [mode = "both", swapsArg = "6", tauArg = "2", perArg = "10", settingsArg = "{}"] = process.argv.slice(2);
const SWAPS = Number(swapsArg);
const TAU = Number(tauArg);
const PER = Number(perArg);
/** One settings object, or a list of them to compare side by side ("new", "new2", …). */
const SETTINGS_LIST = ([] as Partial<LearnerSettings>[]).concat(JSON.parse(settingsArg));
const SHOWN = 12;

type Learner = (base: PilotModel, choices: LineChoice[], bidPack: BidPack, pm: PackMetrics) => PilotModel;
/** Each learner with the choices its version of the app made from a swap. */
const LEARNERS: Record<string, { learn: Learner; choices: (order: string[], ids: string[], from: number, to: number, id: string) => LineChoice[] }> = {
    // Swaps kept, nothing learned.
  none: { learn: (b) => b, choices: () => [] },
  // Before step 2: the moved line beat each line it passed, fitted by `fitWeightsToChoices`.
  old: {
    learn: (b, ch, bp, pm) => fitWeightsToChoices(bp, b, ch, pm).model,
    choices: (_order, ids, from, to) => {
      const passed: { favored: string; overtaken: string }[] = [];
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) if (i !== from) passed.push(to < from ? { favored: ids[from], overtaken: ids[i] } : { favored: ids[i], overtaken: ids[from] });
      return choicesFromDrag(passed);
    },
  },
};
SETTINGS_LIST.forEach((settings, i) => {
  LEARNERS[i ? `new${i + 1}` : "new"] = {
    learn: (b, ch, bp, pm) => learnFromChoices(bp, b, ch, pm, settings).model,
    choices: (order, _ids, _from, _to, id) => choicesFromSwap(order, id),
  };
});
// The new learner on the old reading of a swap (moved line over each line it passed) — separates the two changes.
if (process.env.OLD_PAIRS)
  LEARNERS.newOnOldPairs = {
    learn: (b, ch, bp, pm) => learnFromChoices(bp, b, ch, pm, SETTINGS_LIST[0]).model,
    choices: (order, ids, from, to, id) => LEARNERS.old.choices(order, ids, from, to, id).map((c) => ({ ...c, dragId: id })),
  };
if (SETTINGS_LIST.length > 1) SETTINGS_LIST.forEach((x, i) => console.log(`  ${i ? `new${i + 1}` : "new"} = ${JSON.stringify(x)}`));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length);
/** Lines scored as the app ranks them: with a pilot's trip grades in (`rankLinesWithTrips`) once they have some. */
const scores = (bp: BidPack, m: PilotModel, pm: PackMetrics) => new Map(rankLinesWithTrips(bp, m, { pack: pm }).map((x) => [x.lineNumber, x.score]));

/** One simulated pilot's session: swaps on the shown list, the learner refitting after each. Returns the final model and every line shown. */
function session(bp: BidPack, pm: PackMetrics, base: PilotModel, lines: string[], perceived: (l: string) => number, learner: (typeof LEARNERS)[string], shownCount: number) {
  let model = base;
  const choices: LineChoice[] = [];
  const placements: Placement[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < SWAPS; k++) {
    const s = scores(bp, model, pm);
    const ranked = [...lines].sort((a, b) => s.get(b)! - s.get(a)! || a.localeCompare(b));
    const shown = applyPlacements(ranked, placements, (l) => l).slice(0, shownCount);
    shown.forEach((l) => seen.add(l));
    let drag: { from: number; to: number } | null = null;
    for (let i = 0; i < shown.length && !drag; i++) {
      const best = shown.slice(i).reduce((a, b) => (perceived(a) > perceived(b) ? a : b));
      if (best !== shown[i]) drag = { from: shown.indexOf(best), to: i };
    }
    if (!drag) break;
    const id = `swap-${k}`;
    const placement = placementFromDrag(shown, drag.from, drag.to, id)!;
    placements.push(placement);
    choices.push(...learner.choices(placement.order, shown, drag.from, drag.to, id));
    model = learner.learn(base, choices, bp, pm);
  }
  return { model, seen, placements };
}

/** The whole list as the pilot would bid it — every line ranked by the model, their swaps kept where they put them — as scores by position. */
function bidList(bp: BidPack, pm: PackMetrics, model: PilotModel, lines: string[], placements: Placement[]) {
  const s = scores(bp, model, pm);
  const ranked = applyPlacements([...lines].sort((a, b) => s.get(b)! - s.get(a)! || a.localeCompare(b)), placements, (l) => l);
  return new Map(ranked.map((l, i) => [l, ranked.length - i]));
}

function pairAgreement(s: Map<string, number>, order: string[]) {
  let ok = 0;
  let n = 0;
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
    n++;
    if (s.get(order[i])! > s.get(order[j])!) ok++;
  }
  return n ? ok / n : NaN;
}

function report(title: string, byLearner: Record<string, number[]>, baseline: number[], baselineName = "no learning") {
  console.log(`\n${title}  (n=${baseline.length})`);
  console.log(`  ${baselineName.padEnd(13)} ${(100 * mean(baseline)).toFixed(1)}% ± ${(100 * se(baseline)).toFixed(1)}`);
  for (const [name, xs] of Object.entries(byLearner)) console.log(`  ${name.padEnd(13)} ${(100 * mean(xs)).toFixed(1)}% ± ${(100 * se(xs)).toFixed(1)}`);
  for (const name of Object.keys(byLearner).filter((n) => n !== "old")) {
    const d = byLearner[name].map((x, i) => x - byLearner.old[i]);
    console.log(`  ${`${name} − old`.padEnd(13)} ${(100 * mean(d)).toFixed(1)} points ± ${(100 * se(d)).toFixed(1)}  (better in ${d.filter((x) => x > 1e-9).length}, worse in ${d.filter((x) => x < -1e-9).length})`);
  }
}

function synthetic() {
  const sources: { name: string; bp: BidPack; pm: PackMetrics; model: PilotModel }[] = [];
  const simDir = `${ROOT}/.cache/eval/sim`;
  for (const persona of PERSONAS) {
    const runs = existsSync(simDir) ? readdirSync(simDir).filter((f) => f.startsWith(`${persona.id}-`) && f.endsWith(".json")).sort() : [];
    const packFile = `${ROOT}/.cache/packs/${persona.pack}.json`;
    if (!runs.length || !existsSync(packFile)) continue;
    const run = JSON.parse(readFileSync(`${simDir}/${runs[runs.length - 1]}`, "utf8"));
    const model: PilotModel | undefined = run.preFit ?? run.model;
    if (!model?.criteria?.length) continue;
    const bp = expandBidPack(JSON.parse(readFileSync(packFile, "utf8")));
    sources.push({ name: persona.id, bp, pm: prepareMetrics(bp), model });
  }
  const results: Record<string, number[]> = Object.fromEntries(Object.keys(LEARNERS).map((n) => [n, []]));
  const baseline: number[] = [];
  for (const [si, src] of sources.entries()) {
    const lines = src.bp.lines.map((l) => l.lineNumber);
    for (let p = 0; p < PER; p++) {
      const r = rng(1000 * si + p + 1);
      const truth: PilotModel = { ...src.model, criteria: src.model.criteria.map((c) => ({ ...c, weight: Math.max(0.01, c.weight) * Math.exp(0.6 * gauss(r)) })) };
      const sT = scores(src.bp, truth, src.pm);
      const truthTop = [...lines].sort((a, b) => sT.get(b)! - sT.get(a)!).slice(0, 30);
      const noise = new Map(lines.map((l) => [l, TAU * gauss(r)]));
      const perceived = (l: string) => sT.get(l)! + noise.get(l)!;
      const out: Record<string, { s: Map<string, number>; seen: Set<string> }> = {};
      for (const [name, learner] of Object.entries(LEARNERS)) {
        const { model, seen } = session(src.bp, src.pm, src.model, lines, perceived, learner, SHOWN);
        out[name] = { s: scores(src.bp, model, src.pm), seen };
      }
      // The same held-out lines for every learner: never on screen for any of them.
      const unseen = truthTop.filter((l) => Object.values(out).every((o) => !o.seen.has(l)));
      baseline.push(pairAgreement(scores(src.bp, src.model, src.pm), unseen));
      for (const name of Object.keys(LEARNERS)) results[name].push(pairAgreement(out[name].s, unseen));
    }
    console.log(`  ${src.name.padEnd(26)} ${src.bp.lines.length} lines, ${src.model.criteria.length} criteria`);
  }
  report(`Synthetic pilots, ${SWAPS} swaps, τ=${TAU}: unseen lines of their true top 30`, results, baseline);
}

function expilot() {
  const D = `${ROOT}/private/ex-pilot`;
  if (!existsSync(`${D}/benchmark-oct26/answers.json`)) return console.log("\n(ex-pilot data not found — skipped)");
  const bp = restoreBidPack(JSON.parse(readFileSync(`${D}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`, "utf8")));
  const pm = prepareMetrics(bp);
  const answers = JSON.parse(readFileSync(`${D}/benchmark-oct26/answers.json`, "utf8"));
  const truth: string[] = answers.fullOrder;
  const rank = new Map(truth.map((l, i) => [l, i]));
  // His four piles (top / fine / only if he had to / bottom): the order within a pile is a much finer call than between
  // piles — and what a bid turns on is mostly which pile a line is in.
  const pileOf = new Map<string, number>();
  [answers.piles.top, answers.piles.fine, answers.piles.onlyIfHadTo, answers.piles.bottom].forEach((p: string[], i) => p.forEach((l) => pileOf.set(l, i)));
  const acrossPiles = (s: Map<string, number>, held: string[]) => {
    let ok = 0;
    let n = 0;
    for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
      if (pileOf.get(held[i]) === pileOf.get(held[j])) continue;
      n++;
      if (s.get(held[i])! > s.get(held[j])!) ok++;
    }
    return n ? ok / n : NaN;
  };
  const across: Record<string, number[]> = Object.fromEntries(Object.keys(LEARNERS).map((n) => [n, []]));
  const acrossBaseline: number[] = [];
  // His five real trip picks, as the app fits them after the interview (NO_TRIPS=1 leaves them out).
  const trip = (n: string) => bp.lines.flatMap((l) => l.trips).find((t) => t.pairingNumber === n)!;
  const picks: TripChoice[] = Object.entries(answers.tripPicks as Record<string, [string, string]>).map(([p, [a, b]]) => ({ preferred: tripKey(trip(a)), other: tripKey(trip(b)), strength: p === "C" ? "slightly" : "strongly" }));
  const readings = ["profile-oct21", "replay-v24-s14-1", "replay-v24-s14-2", "replay-v24-s14-3", "replay-v22-v22-a", "replay-v22-v22-b", "replay-v21-v21-a", "replay-v20-v20-aa"]
    .filter((f) => existsSync(`${D}/benchmark-oct26/${f}.json`))
    .map((f) => {
      const p = migrateProfile(JSON.parse(readFileSync(`${D}/benchmark-oct26/${f}.json`, "utf8")));
      const m = applyCityRatings(p.brainInterview!.reviewedModel!, p.cityRatings) as PilotModel;
      return process.env.NO_TRIPS ? m : { ...m, tripWeights: fitTripWeights(bp, m, picks, pm).tripWeights };
    });
  const results: Record<string, number[]> = Object.fromEntries(Object.keys(LEARNERS).map((n) => [n, []]));
  const baseline: number[] = [];
  const whole: Record<string, number[]> = Object.fromEntries(Object.keys(LEARNERS).map((n) => [n, []]));
  const wholeAcross: Record<string, number[]> = Object.fromEntries(Object.keys(LEARNERS).map((n) => [n, []]));
  const wholeBefore: number[] = [];
  const wholeAcrossBefore: number[] = [];
  for (const [ri, base] of readings.entries()) for (let split = 0; split < 6; split++) {
    const r = rng(77 + 13 * ri + split);
    const shownLines = [...truth].sort(() => r() - 0.5).slice(0, 10);
    const held = truth.filter((l) => !shownLines.includes(l));
    const s0 = scores(bp, base, pm);
    baseline.push(pairAgreement(s0, held));
    acrossBaseline.push(acrossPiles(s0, held));
    for (const [name, learner] of Object.entries(LEARNERS)) {
      const { model, placements } = session(bp, pm, base, shownLines, (l) => -rank.get(l)!, learner, 10);
      const s1 = scores(bp, model, pm);
      results[name].push(pairAgreement(s1, held));
      across[name].push(acrossPiles(s1, held));
      whole[name].push(pairAgreement(bidList(bp, pm, model, truth, placements), truth));
      wholeAcross[name].push(acrossPiles(bidList(bp, pm, model, truth, placements), truth));
      // Before step 1: the old fit, and the list re-sorted by it — the swaps didn't stay.
      if (name === "old") {
        wholeBefore.push(pairAgreement(bidList(bp, pm, model, truth, []), truth));
        wholeAcrossBefore.push(acrossPiles(bidList(bp, pm, model, truth, []), truth));
      }
    }
  }
  report(`The ex-pilot's real order, ${SWAPS} swaps on 10 lines: the 10 held out, every pair`, results, baseline);
  report(`  … only pairs from different piles`, across, acrossBaseline);
  report(`His whole list as he'd bid it (all 20 lines, his swaps kept), every pair`, whole, wholeBefore, "before step 1");
  report(`  … only pairs from different piles`, wholeAcross, wholeAcrossBefore, "before step 1");
}

if (mode === "synthetic" || mode === "both") synthetic();
if (mode === "expilot" || mode === "both") expilot();
