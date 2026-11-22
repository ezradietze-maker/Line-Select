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
 *
 * The question after a swap, three ways: "rare" (Nov 7–21: only an unclear swap, once per 5 swaps and 3 a session, no
 * guess shown), and "every" (from Nov 21: every swap, the brain's guess first). For "every", ACCEPT lists how often the
 * simulated pilot says yes to a wrong guess (default "0,0.3": honest, and agreeable), and CONFIRMED the share a confirmed
 * guess counts (`LEARNER.answer.confirmed`; default "0.25,0.5,1").
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
import type { LineChoice, PilotModel, SwapAnswer, TripChoice } from "@/types/pilot-model";
import { explainSwap } from "@/lib/brain/explain-swap";
import { criterionFromAnswer, pickSwapQuestion, untrackedFactor, type FactorOption, type SwapQuestion } from "@/lib/brain/swap-question";
import { scorePackV2 } from "@/lib/scoring-v2/score";
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
  const ASKS = askModes();
  const results: Record<string, number[]> = Object.fromEntries([...Object.keys(LEARNERS), ...ASKS.map((a) => a.name)].map((n) => [n, []]));
  const counts: Record<string, { asked: number; confirmed: number; wrongYes: number; swaps: number }> = Object.fromEntries(ASKS.map((a) => [a.name, { asked: 0, confirmed: 0, wrongYes: 0, swaps: 0 }]));
  const baseline: number[] = [];
  let hiddenNamed = 0;
  for (const [si, src] of sources.entries()) {
    const lines = src.bp.lines.map((l) => l.lineNumber);
    for (let p = 0; p < PER; p++) {
      const r = rng(1000 * si + p + 1);
      const weighted: PilotModel = { ...src.model, criteria: src.model.criteria.map((c) => ({ ...c, weight: Math.max(0.01, c.weight) * Math.exp(0.6 * gauss(r)) })) };
      // HIDDEN=1: the pilot also cares about something the interview never named.
      const truth = process.env.HIDDEN ? withHidden(weighted, r) : weighted;
      const sT = scores(src.bp, truth, src.pm);
      const truthTop = [...lines].sort((a, b) => sT.get(b)! - sT.get(a)!).slice(0, 30);
      const noise = new Map(lines.map((l) => [l, TAU * gauss(r)]));
      const perceived = (l: string) => sT.get(l)! + noise.get(l)!;
      const out: Record<string, { s: Map<string, number>; seen: Set<string> }> = {};
      for (const [name, learner] of Object.entries(LEARNERS)) {
        const { model, seen } = session(src.bp, src.pm, src.model, lines, perceived, learner, SHOWN);
        out[name] = { s: scores(src.bp, model, src.pm), seen };
      }
      for (const a of ASKS) {
        const asked = askSession(src.bp, src.pm, src.model, truth, lines, perceived, SHOWN, a, rng(7919 * (1000 * si + p + 1)));
        out[a.name] = { s: scores(src.bp, asked.model, src.pm), seen: asked.seen };
        for (const k of ["asked", "confirmed", "wrongYes", "swaps"] as const) counts[a.name][k] += asked.tally[k];
        if (a.name === "rare" && asked.named) hiddenNamed++;
      }
      // The same held-out lines for every learner: never on screen for any of them.
      const unseen = truthTop.filter((l) => Object.values(out).every((o) => !o.seen.has(l)));
      baseline.push(pairAgreement(scores(src.bp, src.model, src.pm), unseen));
      for (const name of Object.keys(out)) results[name].push(pairAgreement(out[name].s, unseen));
    }
    console.log(`  ${src.name.padEnd(26)} ${src.bp.lines.length} lines, ${src.model.criteria.length} criteria`);
  }
  report(`Synthetic pilots${process.env.HIDDEN ? " with a factor the interview never named" : ""}, ${SWAPS} swaps, τ=${TAU}: unseen lines of their true top 30`, results, baseline);
  // Each way of asking against the rare question, pilot by pilot.
  for (const a of ASKS.filter((x) => x.name !== "rare")) {
    const d = results[a.name].map((x, i) => x - results.rare[i]);
    const c = counts[a.name];
    console.log(`  ${`${a.name} − rare`.padEnd(24)} ${(100 * mean(d)).toFixed(2)} points ± ${(100 * se(d)).toFixed(2)}  (better in ${d.filter((x) => x > 1e-9).length}, worse in ${d.filter((x) => x < -1e-9).length}) · asked ${c.asked} of ${c.swaps} swaps, guess confirmed ${c.confirmed}, of them wrongly ${c.wrongYes}`);
  }
  const r = counts.rare;
  if (r) console.log(`  rare asked ${r.asked} of ${r.swaps} swaps`);
  if (process.env.HIDDEN) console.log(`  the hidden factor got named and added for ${hiddenNamed} of ${baseline.length} pilots`);
}

/** Measures a simulated pilot may secretly care about, with the way they'd want them. */
const HIDDEN_FACTORS: [string, "more" | "less"][] = [
  ["daysOff", "more"], ["longestDaysOffBlock", "more"], ["weekendDaysOff", "more"], ["creditHours", "more"], ["longDuties", "less"],
  ["earlyReports", "less"], ["redEyeLegs", "less"], ["nightsWorked", "less"], ["dutiesWithManyLegs", "less"], ["landings", "less"], ["tafbHours", "less"],
];

/** The pilot's true model with one factor the interview never named, counting about half as much as their top priority. */
function withHidden(model: PilotModel, r: () => number): PilotModel {
  const used = new Set(model.criteria.map((c) => c.metric));
  const options = HIDDEN_FACTORS.filter(([m]) => !used.has(m));
  const [metric, kind] = options[Math.floor(r() * options.length)];
  const top = Math.max(...model.criteria.map((c) => c.weight));
  return { ...model, criteria: [...model.criteria, { id: `hidden-${metric}`, metric, shape: { kind }, tier: "medium", weight: 0.5 * top, confidence: 1, label: metric, evidence: [], status: "settled" }] };
}

interface AskMode {
  name: string;
  kind: "rare" | "every";
  /** How often the simulated pilot says yes to a wrong guess. */
  accept: number;
  settings: Partial<LearnerSettings>;
}

function askModes(): AskMode[] {
  const accepts = (process.env.ACCEPT ?? "0,0.3").split(",").map(Number);
  const confirmeds = (process.env.CONFIRMED ?? "0.25,0.5,1").split(",").map(Number);
  const base = SETTINGS_LIST[0];
  const modes: AskMode[] = [{ name: "rare", kind: "rare", accept: 0, settings: base }];
  for (const accept of accepts)
    for (const confirmed of confirmeds)
      modes.push({ name: `every c=${confirmed} yes=${accept}`, kind: "every", accept, settings: { ...base, answer: { weight: 2.5, beta: 0.4, ...base.answer, confirmed } } });
  return modes;
}

/** The rare question, as the app asked it Nov 7–21: only an unclear swap, once per 5 swaps and 3 a session, no guess. */
function rareQuestion(q: SwapQuestion | null, why: ReturnType<typeof explainSwap>, state: { swapsSince: number; asked: number; pairs: Set<string> }, pair: string): SwapQuestion | null {
  if (!q || state.asked >= 3 || (state.asked > 0 && state.swapsSince < 5) || state.pairs.has(pair)) return null;
  if (q.kind === "limit") return q;
  if (why.verdict !== "ambiguous" && why.verdict !== "unexplained") return null;
  const options = why.verdict === "ambiguous" ? q.options.filter((o) => !o.criterionId || why.explains.some((f) => f.criterionId === o.criterionId)) : q.options;
  return options.length ? { ...q, options, guess: null } : null;
}

/**
 * A session with the question after swaps, answered by the simulated pilot from its true preferences: the priority (or
 * hidden factor) that truly pulled hardest for the line it put higher — picked if offered, else "typed" (standing in for
 * the reason route matching their words) — or "about equal" when nothing truly favoured it (a noisy swap). Shown a
 * guess, it says yes when the guess is that reason; when it isn't, it still says yes `accept` of the time.
 */
function askSession(bp: BidPack, pm: PackMetrics, interview: PilotModel, truth: PilotModel, lines: string[], perceived: (l: string) => number, shownCount: number, mode: AskMode, r: () => number) {
  let base = interview;
  let model = interview;
  const choices: LineChoice[] = [];
  const answers: SwapAnswer[] = [];
  const placements: Placement[] = [];
  const seen = new Set<string>();
  const rare = { swapsSince: 0, asked: 0, pairs: new Set<string>() };
  const tally = { asked: 0, confirmed: 0, wrongYes: 0, swaps: 0 };
  const truthScores = new Map(scorePackV2(bp, truth, { pack: pm }).map((s) => [s.lineNumber, s]));
  let named = false;
  // A measure never named, as the priority it becomes once the pilot agrees to it.
  const adopt = (o: FactorOption) => {
    const c = criterionFromAnswer(o, "typed");
    if (!base.criteria.some((x) => x.id === c.id)) base = { ...base, criteria: [...base.criteria, c] };
    return c.id;
  };
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
    tally.swaps++;
    const id = `swap-${k}`;
    const placement = placementFromDrag(shown, drag.from, drag.to, id)!;
    placements.push(placement);
    const [higher, lower] = [placement.order[0], placement.order[placement.order.length - 1]];
    choices.push(...choicesFromSwap(placement.order, id));
    const before = new Map(scorePackV2(bp, model, { pack: pm }).map((x) => [x.lineNumber, x]));
    const why = explainSwap(before.get(higher)!, before.get(lower)!);
    rare.swapsSince++;
    const untracked = why.verdict === "limit" ? null : untrackedFactor(bp, pm, model, higher, lower);
    const every = pickSwapQuestion(why, { dragId: id, higher, lower }, false, mode.kind === "rare" && why.verdict !== "unexplained" ? null : untracked);
    const pair = [higher, lower].sort().join("|");
    const question = mode.kind === "rare" ? rareQuestion(every, why, rare, pair) : every;
    if (question?.kind === "factors") {
      tally.asked++;
      rare.asked++;
      rare.swapsSince = 0;
      rare.pairs.add(pair);
      // The pilot's real main reason: the priority (or hidden factor) that truly pulled hardest for the higher line.
      const truly = explainSwap(truthScores.get(higher)!, truthScores.get(lower)!).factors.filter((f) => f.share > 0)[0];
      const offered = question.options.flatMap((o) => (o.criterionId ? [o.criterionId] : []));
      const guess = question.guess;
      const hiddenMetric = truly?.criterionId.startsWith("hidden-") ? truly.criterionId.slice("hidden-".length) : null;
      const guessRight = !!guess && !!truly && (guess.criterionId ? guess.criterionId === truly.criterionId : guess.metric === hiddenMetric);
      const guessedId = guess ? (guess.criterionId ?? criterionFromAnswer(guess, "typed").id) : undefined;
      const says = guess && (guessRight || (truly && r() < mode.accept));
      if (says) {
        // A tap on the guess: the right reason, or (agreeable) a wrong one.
        tally.confirmed++;
        if (!guessRight) tally.wrongYes++;
        const cid = guess.criterionId ?? adopt(guess);
        answers.push({ dragId: id, higher, lower, kind: "factor", criterionId: cid, offered: [...new Set([...offered, cid])], guessed: cid });
        if (guessRight && hiddenMetric) named = true;
      } else if (!truly) answers.push({ dragId: id, higher, lower, kind: "equal" });
      else if (hiddenMetric) {
        const kind = truth.criteria.find((c) => c.id === truly.criterionId)!.shape.kind as "more" | "less";
        const cid = adopt({ metric: hiddenMetric, direction: kind, label: hiddenMetric, amounts: "" });
        const picked = question.options.some((o) => o.metric === hiddenMetric);
        answers.push({ dragId: id, higher, lower, kind: "factor", criterionId: cid, offered: [...offered, cid], ...(guessedId ? { guessed: guessedId } : {}), ...(picked ? {} : { text: "typed" }) });
        named = true;
      } else {
        const picked = offered.includes(truly.criterionId);
        answers.push({ dragId: id, higher, lower, kind: "factor", criterionId: truly.criterionId, offered: [...new Set([...offered, truly.criterionId])], ...(guessedId ? { guessed: guessedId } : {}), ...(picked ? {} : { text: "typed" }) });
      }
    }
    model = learnFromChoices(bp, base, choices, pm, mode.settings, answers).model;
  }
  return { model, seen, named, tally, placements };
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
  // The question after a swap, answered as his whole real order implies (his reasons themselves were never asked): a
  // stand-in "true" model fitted to every pair of his 20 lines, which answers each question as askSession's pilots do.
  const ASKS = askModes();
  const asked: Record<string, number[]> = Object.fromEntries(ASKS.map((a) => [a.name, []]));
  const askedWhole: Record<string, number[]> = Object.fromEntries(ASKS.map((a) => [a.name, []]));
  const fullOrder: LineChoice[] = truth.flatMap((a, i) => truth.slice(i + 1).map((b) => ({ preferred: a, other: b, strength: "slightly" as const })));
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
    const oracle = learnFromChoices(bp, base, fullOrder, pm).model;
    for (const a of ASKS) {
      const run = askSession(bp, pm, base, oracle, shownLines, (l) => -rank.get(l)!, 10, a, rng(31 * ri + split + 5));
      asked[a.name].push(pairAgreement(scores(bp, run.model, pm), held));
      askedWhole[a.name].push(pairAgreement(bidList(bp, pm, run.model, truth, run.placements), truth));
    }
  }
  const vsRare = (title: string, xs: Record<string, number[]>) => {
    console.log(`\n${title}`);
    for (const a of ASKS) {
      const d = xs[a.name].map((x, i) => x - xs.rare[i]);
      console.log(`  ${a.name.padEnd(22)} ${(100 * mean(xs[a.name])).toFixed(1)}% ± ${(100 * se(xs[a.name])).toFixed(1)}${a.name === "rare" ? "" : `   vs rare ${(100 * mean(d)).toFixed(2)} ± ${(100 * se(d)).toFixed(2)} (better in ${d.filter((x) => x > 1e-9).length}, worse in ${d.filter((x) => x < -1e-9).length})`}`);
    }
  };
  vsRare("The ex-pilot with the question after swaps, answered as his whole order implies: the 10 held out", asked);
  vsRare("  … his whole list as he'd bid it", askedWhole);
  report(`The ex-pilot's real order, ${SWAPS} swaps on 10 lines: the 10 held out, every pair`, results, baseline);
  report(`  … only pairs from different piles`, across, acrossBaseline);
  report(`His whole list as he'd bid it (all 20 lines, his swaps kept), every pair`, whole, wholeBefore, "before step 1");
  report(`  … only pairs from different piles`, wholeAcross, wholeAcrossBefore, "before step 1");
}

if (mode === "synthetic" || mode === "both") synthetic();
if (mode === "expilot" || mode === "both") expilot();
