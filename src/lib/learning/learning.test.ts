import { describe, expect, it } from "vitest";
import { FEATURE_COUNT, type LineFeatures } from "@/lib/forecast/features";
import { mulberry32 } from "@/lib/forecast/random";
import { EXPLICIT_WEIGHT_IDS } from "@/lib/interview-engine";
import { assumedFact } from "@/lib/learning/assumed-facts";
import type { Cohort } from "@/lib/learning/cohort";
import { cohortLevels, seniorityBandOf } from "@/lib/learning/cohort";
import {
  applyCalibration,
  brierScore,
  fitCalibration,
  learnForecastPriors,
  pairsFromAward,
  resolveForecastPrior,
  type CalibrationPair,
} from "@/lib/learning/forecast-learning";
import { summarizeHoldHistory, type HoldRecord } from "@/lib/learning/hold-history";
import {
  ASSUME_RULES,
  backtestInterviewModel,
  computeInterviewModel,
  decideInterviewPolicy,
  explorationRate,
  resolveCohort,
  type CorrectionEvent,
  type InterviewModel,
} from "@/lib/learning/interview-learning";
import { bucketOf, type Bucket, type InterviewOutcome } from "@/lib/learning/interview-outcome";

/**
 * The learning is tested the way it will actually run: whole simulated
 * fleets of pilots, interviewed round after round, each round learning from
 * the last. The tests check the behavior that matters — it refuses to skip
 * a question before it has proven it can predict the answer, earns the skip
 * once it has, stops skipping when pilots start correcting it, lets a busy
 * base speak for itself while a new one borrows from the fleet, never
 * learns from its own guesses, and calibrates an overconfident forecast.
 */

const MEM_LOCAL: Cohort = { base: "MEM", aircraft: "B767", seat: "FO", commute: "local", seniority: "middle" };

/** What a simulated pilot actually wants: per dimension, the chance of each answer and how strongly. */
type Truth = Partial<Record<string, { zero: number; pos: number; neg?: number; strength?: number }>>;

const DEFAULT_TRUTH: Truth = {
  daysOff: { zero: 0.03, pos: 0.95, neg: 0.02, strength: 80 },
  landings: { zero: 0.9, pos: 0.06, neg: 0.04, strength: 40 },
  hotelGym: { zero: 0.5, pos: 0.5, strength: 50 },
};

function drawAnswer(rand: () => number, t: { zero: number; pos: number; neg?: number; strength?: number }): number {
  const r = rand();
  const s = t.strength ?? 50;
  if (r < t.zero) return 0;
  if (r < t.zero + t.pos) return s;
  return -s;
}

/**
 * One round of interviews. With a model in hand, each pilot gets the policy
 * it would really run: assumed dimensions take the group answer, asked ones
 * take the pilot's own — exactly the data the live system stores.
 */
function interviewRound(params: {
  count: number;
  cohort: Cohort;
  truth: Truth;
  model: InterviewModel | null;
  seed: number;
  /** Chance a pilot fixes an assumption that was wrong for them on the Preferences screen. */
  correctsWrongAssumption?: number;
}): { outcomes: InterviewOutcome[]; corrections: CorrectionEvent[] } {
  const rand = mulberry32(params.seed);
  const outcomes: InterviewOutcome[] = [];
  const corrections: CorrectionEvent[] = [];
  for (let i = 0; i < params.count; i++) {
    const policy = params.model ? decideInterviewPolicy(resolveCohort(params.model, params.cohort), params.model.corrections, rand) : null;
    const dims: InterviewOutcome["dims"] = {};
    const predictions: Record<string, Bucket> = {};
    for (const dim of EXPLICIT_WEIGHT_IDS) {
      const t = params.truth[dim] ?? { zero: 0.34, pos: 0.33, neg: 0.33 };
      const real = drawAnswer(rand, t);
      const d = policy?.decisions[dim];
      if (d) predictions[dim] = d.prediction;
      if (d?.action === "assume") {
        const assumed = d.prediction === "zero" ? 0 : d.prediction === "pos" ? 50 : -50;
        dims[dim] = { w: assumed, src: "assumed" };
        if (bucketOf(dim, real) !== d.prediction && rand() < (params.correctsWrongAssumption ?? 0)) {
          corrections.push({ dim, src: "assumed", from: assumed, to: real });
        }
      } else {
        dims[dim] = { w: real, src: "asked" };
      }
    }
    outcomes.push({
      v: 1,
      month: "OCT26",
      cohort: params.cohort,
      modelVersion: params.model?.version ?? null,
      story: { provided: true, facts: 5 },
      turns: 12,
      wrapped: true,
      dims,
      implicit: {},
      targets: { daysOff: { ideal: 14 + Math.floor(rand() * 3) } },
      cities: { loved: 1, avoided: 1 },
      dealbreakers: [],
      predictions,
      questions: [
        { topic: "rest-recovery", kind: "free-text", skipped: false, chars: 120, added: rand() < 0.75 ? 1 : 0, elaboration: false },
        { topic: "landings-currency", kind: "slider", boundTo: "landings", skipped: false, chars: 0, added: rand() < 0.1 ? 1 : 0, elaboration: false },
      ],
    });
  }
  return { outcomes, corrections };
}

const noExplore = () => 0.999;

describe("cohorts", () => {
  it("goes from the whole fleet down to one base and commute", () => {
    expect(cohortLevels(MEM_LOCAL)).toEqual(["all", "seat:FO", "seat:FO|local", "pack:MEM|B767|FO", "pack:MEM|B767|FO|local"]);
  });

  it("splits the bid order into thirds", () => {
    expect(seniorityBandOf(0.9)).toBe("senior");
    expect(seniorityBandOf(0.5)).toBe("middle");
    expect(seniorityBandOf(0.1)).toBe("junior");
    expect(seniorityBandOf(null)).toBe("unknown");
  });
});

describe("interview learning, round after round", () => {
  const round1 = interviewRound({ count: 300, cohort: MEM_LOCAL, truth: DEFAULT_TRUTH, model: null, seed: 1 });
  const model1 = computeInterviewModel(round1.outcomes, round1.corrections, "v1", new Date("2026-10-01"));

  it("learns what pilots in a group answer", () => {
    const r = resolveCohort(model1, MEM_LOCAL);
    expect(r.dims.landings.majority).toBe("zero");
    expect(r.dims.landings.consensus).toBeGreaterThan(0.8);
    expect(r.dims.daysOff.majority).toBe("pos");
    expect(r.dims.hotelGym.consensus).toBeLessThan(0.6);
  });

  it("won't skip a question it has never been checked on, however lopsided the answers", () => {
    const policy = decideInterviewPolicy(resolveCohort(model1, MEM_LOCAL), model1.corrections, noExplore);
    expect(policy.decisions.landings.action).toBe("ask");
    expect(policy.decisions.landings.why).toMatch(/checked on 0/);
  });

  // Round two runs with model 1: every answer now carries a prediction made before it was given.
  const round2 = interviewRound({ count: 150, cohort: MEM_LOCAL, truth: DEFAULT_TRUTH, model: model1, seed: 2 });
  const model2 = computeInterviewModel([...round1.outcomes, ...round2.outcomes], [...round1.corrections, ...round2.corrections], "v2", new Date("2026-11-01"));

  it("earns the right to skip once its predictions have been checked against real answers", () => {
    const r = resolveCohort(model2, MEM_LOCAL);
    expect(r.dims.landings.validated).toBeGreaterThanOrEqual(ASSUME_RULES.minValidated);
    expect(r.dims.landings.accuracy).toBeGreaterThan(ASSUME_RULES.minAccuracy);
    const policy = decideInterviewPolicy(r, model2.corrections, noExplore);
    expect(policy.decisions.landings.action).toBe("assume");
    // Split answers are never assumed, and days off is always asked.
    expect(policy.decisions.hotelGym.action).toBe("ask");
    expect(policy.decisions.daysOff.action).toBe("ask");
  });

  it("keeps asking a share of pilots anyway, so its accuracy keeps being measured", () => {
    const r = resolveCohort(model2, MEM_LOCAL);
    let asked = 0;
    const rand = mulberry32(9);
    for (let i = 0; i < 1000; i++) if (decideInterviewPolicy(r, model2.corrections, rand).decisions.landings.action === "ask") asked++;
    expect(asked / 1000).toBeGreaterThan(explorationRate(r.dims.landings.validated) * 0.7);
    expect(asked / 1000).toBeLessThan(0.35);
    expect(explorationRate(10_000)).toBeCloseTo(0.05, 2);
  });

  it("never learns from its own assumptions", () => {
    const round3 = interviewRound({ count: 200, cohort: MEM_LOCAL, truth: DEFAULT_TRUTH, model: model2, seed: 3 });
    const assumedOnly = round3.outcomes.map((o) => ({ ...o, dims: { landings: { ...o.dims.landings, src: "assumed" as const } } }));
    const before = model2.levels["all"].dims.landings.n;
    const after = computeInterviewModel([...round1.outcomes, ...round2.outcomes, ...assumedOnly], [], "v3", new Date()).levels["all"].dims.landings.n;
    expect(after).toBe(before);
  });

  it("stops skipping a question when pilots keep correcting the assumption", () => {
    // The population shifted: landings now split. Assumed answers are wrong for many, and pilots fix them.
    const shifted: Truth = { ...DEFAULT_TRUTH, landings: { zero: 0.55, pos: 0.4, neg: 0.05, strength: 60 } };
    const round3 = interviewRound({ count: 200, cohort: MEM_LOCAL, truth: shifted, model: model2, seed: 4, correctsWrongAssumption: 0.6 });
    const all = [...round1.outcomes, ...round2.outcomes, ...round3.outcomes];
    const model3 = computeInterviewModel(all, round3.corrections, "v3", new Date("2026-12-01"));
    const policy = decideInterviewPolicy(resolveCohort(model3, MEM_LOCAL), model3.corrections, noExplore);
    expect(policy.decisions.landings.action).toBe("ask");
    expect(policy.decisions.landings.why).toMatch(/corrected later/);
  });

  it("turns topic results into what to spend questions on", () => {
    const policy = decideInterviewPolicy(resolveCohort(model2, MEM_LOCAL), model2.corrections, noExplore);
    expect(policy.productiveTopics).toContain("rest-recovery");
    expect(policy.quietTopics).toContain("landings-currency");
    // Focus is where this group genuinely splits — never a dimension it can predict.
    expect(policy.focus.map((f) => f.dim)).not.toContain("landings");
    for (const f of policy.focus) expect(Math.max(f.shares.zero, f.shares.pos, f.shares.neg)).toBeLessThan(0.6);
    expect(policy.targets["daysOff:ideal"].median).toBeGreaterThanOrEqual(14);
  });

  it("only promotes a model that predicts new pilots better", () => {
    const empty = computeInterviewModel([], [], "v0", new Date());
    const heldOut = round2.outcomes.slice(0, 80);
    const learned = backtestInterviewModel(model1, heldOut);
    const blank = backtestInterviewModel(empty, heldOut);
    expect(learned.logLoss).toBeLessThan(blank.logLoss);
    expect(learned.accuracy).toBeGreaterThan(blank.accuracy);
  });
});

describe("groups borrow from the fleet until they have their own pilots", () => {
  const fleetTruth: Truth = { hotelGym: { zero: 0.5, pos: 0.5, strength: 50 } };
  const ancGymTruth: Truth = { hotelGym: { zero: 0.08, pos: 0.92, strength: 70 } };
  const ANC: Cohort = { base: "ANC", aircraft: "B777", seat: "FO", commute: "local", seniority: "middle" };
  const IND: Cohort = { base: "IND", aircraft: "B767", seat: "FO", commute: "local", seniority: "middle" };
  const fleet = interviewRound({ count: 400, cohort: MEM_LOCAL, truth: fleetTruth, model: null, seed: 5 }).outcomes;

  it("a base with plenty of its own pilots speaks for itself", () => {
    const anc = interviewRound({ count: 200, cohort: ANC, truth: ancGymTruth, model: null, seed: 6 }).outcomes;
    const r = resolveCohort(computeInterviewModel([...fleet, ...anc], [], "v", new Date()), ANC);
    expect(r.dims.hotelGym.majority).toBe("pos");
    expect(r.dims.hotelGym.consensus).toBeGreaterThan(0.8);
  });

  it("a brand-new base leans on the fleet rather than five pilots", () => {
    const ind = interviewRound({ count: 5, cohort: IND, truth: ancGymTruth, model: null, seed: 7 }).outcomes;
    const r = resolveCohort(computeInterviewModel([...fleet, ...ind], [], "v", new Date()), IND);
    expect(r.dims.hotelGym.consensus).toBeLessThan(0.75);
  });
});

describe("assumed answers", () => {
  it("read as an assumption the pilot can change, carrying no weight when the group says it doesn't matter", () => {
    const f = assumedFact({ dim: "landings", bucket: "zero", share: 0.88, support: 212, typicalStrength: 0, modelVersion: "v2" });
    expect(f.statement).toMatch(/^Assumed: the number of landings doesn't matter much — 88% of 212 pilots/);
    expect(f.importance).toBe(0);
    expect(f.source).toEqual({ kind: "population-prior", modelVersion: "v2" });
    expect(f.confidence).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

function syntheticFeatures(lines: number, seed: number): LineFeatures {
  const rand = mulberry32(seed);
  const values = new Float64Array(lines * FEATURE_COUNT);
  for (let i = 0; i < values.length; i++) values[i] = (rand() - 0.5) * 3.4;
  return { lineIds: Array.from({ length: lines }, (_, i) => `l${i}`), lineNumbers: Array.from({ length: lines }, (_, i) => String(2000 + i)), values, lineCount: lines };
}

function rankingFor(features: LineFeatures, weights: number[], rand: () => number): number[] {
  const scores = Array.from({ length: features.lineCount }, (_, i) => {
    let s = (rand() - 0.5) * 0.6;
    for (let k = 0; k < FEATURE_COUNT; k++) s += weights[k] * features.values[i * FEATURE_COUNT + k];
    return { i, s };
  });
  return scores.sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.i);
}

describe("forecast learns what pilots at a seat want, across months", () => {
  it("moves its starting beliefs toward what real rankings show", () => {
    // Pilots here care hugely about credit (feature 1) — far more than the reasoned default assumes.
    const truth = [0.4, 1.6, -0.3, 0, 0, 0, -0.2, 0, -0.1, 0];
    const rand = mulberry32(11);
    const history = [1, 2, 3].map((m) => {
      const features = syntheticFeatures(80, 100 + m);
      return { base: "MEM", aircraft: "B767", seat: "FO", features, rankings: Array.from({ length: 30 }, () => rankingFor(features, truth, rand)) };
    });
    const model = learnForecastPriors(history, "f1", new Date());
    const prior = resolveForecastPrior(model, "MEM", "B767", "FO")!;
    expect(prior.n).toBe(90);
    // Credit now leads the other features, as it does in the real rankings.
    expect(prior.mean[1]).toBeGreaterThan(prior.mean[0]);
    expect(prior.mean[1]).toBeGreaterThan(0.6);
    expect(resolveForecastPrior(learnForecastPriors([], "f0", new Date()), "MEM", "B767", "FO")).toBeNull();
  });
});

describe("forecast calibrated against real awards", () => {
  it("reads what an award proves: ranked above it was gone, the award was open, below says nothing", () => {
    const prediction = { ranking: [5, 9, 2, 7], pAvailable: [0.2, 0.5, 0.8, 0.9] };
    expect(pairsFromAward(prediction, { outcome: "line", lineIndex: 2 })).toEqual([
      { p: 0.2, y: 0 },
      { p: 0.5, y: 0 },
      { p: 0.8, y: 1 },
    ]);
    expect(pairsFromAward(prediction, { outcome: "reserve", lineIndex: null })).toHaveLength(4);
    expect(pairsFromAward(prediction, { outcome: "other", lineIndex: null })).toEqual([]);
  });

  it("corrects a forecast that's been too optimistic, and scores better for it", () => {
    // The forecast says p, but lines are really open only p² of the time.
    const rand = mulberry32(21);
    const pairs: CalibrationPair[] = Array.from({ length: 4000 }, () => {
      const p = rand();
      return { p, y: rand() < p * p ? 1 : 0 };
    });
    const train = pairs.slice(0, 3000);
    const test = pairs.slice(3000);
    const cal = fitCalibration(train, "c1", new Date());
    expect(brierScore(test, cal)).toBeLessThan(brierScore(test));
    expect(applyCalibration(cal, 0.5)).toBeLessThan(0.4);
    // Never inverted: a higher forecast never maps lower.
    for (let i = 1; i < cal.points.length; i++) expect(cal.points[i].q).toBeGreaterThanOrEqual(cal.points[i - 1].q);
  });

  it("leaves a forecast alone when there's nothing to correct it with", () => {
    expect(applyCalibration(null, 0.42)).toBe(0.42);
  });
});

describe("a pilot's own holding history", () => {
  const rec = (month: string, choice: number | null, outcome: HoldRecord["outcome"] = "line", percentile = 0.4): HoldRecord => ({
    month,
    base: "MEM",
    aircraft: "B767",
    seat: "FO",
    percentile,
    outcome,
    awardedChoice: choice,
    daysOff: 14,
    creditHours: 80,
    submittedAt: "2026-10-01T00:00:00Z",
  });

  it("says what they usually hold, newest first, one record a month", () => {
    const s = summarizeHoldHistory([rec("AUG26", 12, "line", 0.35), rec("OCT26", 8, "line", 0.45), rec("SEP26", 10), rec("SEP26", 30), rec("JUL26", null, "reserve", 0.3)]);
    expect(s.months).toBe(4);
    expect(s.records[0].month).toBe("OCT26");
    expect(s.typicalChoice).toBe(10);
    expect(s.reserveMonths).toBe(1);
    expect(s.seniorityTrend).toEqual({ from: 0.3, to: 0.45 });
    expect(s.headline).toMatch(/around your #10 choice/);
  });
});
