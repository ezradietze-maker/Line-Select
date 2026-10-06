import { describe, expect, it } from "vitest";
import { assumedFact } from "@/lib/learning/assumed-facts";
import { correctionEvents, isLearnablePack } from "@/lib/learning/corrections";
import { buildInterviewOutcome } from "@/lib/learning/interview-outcome";
import { insightsFromPlan, type InterviewPlan } from "@/lib/learning/learning-client";
import { parseCorrections, parseInterviewOutcome } from "@/lib/learning/validate";
import type { PreferenceFact } from "@/types/interview-session";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

/**
 * The edges of the learning: what a pilot's browser sends, what the server
 * accepts, and what the interview is handed back. The rule throughout is
 * that only numbers and known labels cross — never a pilot's words.
 */

function makeProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    deepRoundCompleted: false,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter: false,
    hasCrashPad: null,
    cityPreferences: {},
    completedAt: new Date(0).toISOString(),
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts: [],
    interviewTranscript: [],
    ...overrides,
  };
}

function weightFact(key: string, direction: 1 | -1, source: PreferenceFact["source"], statement = "Wants every day off they can get, kids' soccer on Tuesdays"): PreferenceFact {
  return {
    id: crypto.randomUUID(),
    statement,
    kind: "measurable",
    measurable: { type: "explicit-weight", key: key as never, direction },
    confidence: 0.9,
    importance: 0.8,
    source,
    turnIndex: 1,
  };
}

const COHORT = { base: "MEM", aircraft: "B767", seat: "FO", commute: "local" as const, seniority: "middle" as const };

function outcomeFor(profile: PreferenceProfile) {
  return buildInterviewOutcome({ profile, transcript: [], cohort: COHORT, month: "NOV26", modelVersion: "i-20261006T09", predictions: { daysOff: "pos" }, wrapped: true });
}

describe("interview outcomes over the wire", () => {
  const profile = makeProfile({
    weights: { ...DEFAULT_WEIGHTS, daysOff: 80, landings: 0 },
    discoveredFacts: [
      weightFact("daysOff", 1, { kind: "seed-question", questionKey: "bidding-story" }),
      assumedFact({ dim: "landings", bucket: "zero", share: 0.9, support: 120, typicalStrength: 30, modelVersion: "i-20261006T09" }),
    ],
    explicitTargets: { daysOff: { min: 14, ideal: 16 } },
    cityPreferences: { ANC: "love", NRT: "avoid" },
  });

  it("survives the round trip through strict validation unchanged", () => {
    const outcome = outcomeFor(profile);
    expect(parseInterviewOutcome(JSON.parse(JSON.stringify(outcome)))).toEqual(outcome);
  });

  it("never carries the pilot's words, cities, or the assumed fact's wording", () => {
    const wire = JSON.stringify(outcomeFor(profile));
    expect(wire).not.toContain("soccer");
    expect(wire).not.toContain("ANC");
    expect(wire).not.toContain("NRT");
    expect(wire).not.toContain("pilots like you");
  });

  it("records an assumed answer as assumed, so it never teaches the learning", () => {
    const outcome = outcomeFor(profile);
    expect(outcome.dims.landings?.src).toBe("assumed");
    expect(outcome.dims.daysOff?.src).toBe("story");
  });

  it("rejects the demo pack, unknown dimensions, out-of-range numbers and free text", () => {
    const good = JSON.parse(JSON.stringify(outcomeFor(profile)));
    expect(parseInterviewOutcome({ ...good, month: "SAMPLE" })).toBeNull();
    expect(parseInterviewOutcome({ ...good, dims: { ...good.dims, favoriteColor: { w: 10, src: "asked" } } })).toBeNull();
    expect(parseInterviewOutcome({ ...good, dims: { daysOff: { w: 400, src: "asked" } } })).toBeNull();
    expect(parseInterviewOutcome({ ...good, cohort: { ...good.cohort, base: "MEM; DROP TABLE" } })).toBeNull();
    expect(parseInterviewOutcome({ ...good, dealbreakers: ["I hate my chief pilot, call me at 555"] })).toBeNull();
    expect(parseInterviewOutcome({ ...good, questions: Array.from({ length: 61 }, () => good.questions[0] ?? {}) })).toBeNull();
    expect(parseInterviewOutcome(null)).toBeNull();
  });

  it("drops fields it doesn't know rather than storing them", () => {
    const parsed = parseInterviewOutcome({ ...JSON.parse(JSON.stringify(outcomeFor(profile))), transcript: "every word" });
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("every word");
  });
});

describe("corrections", () => {
  it("names where each corrected value came from", () => {
    const before = makeProfile({
      weights: { ...DEFAULT_WEIGHTS, daysOff: 70, landings: 0, hotelGym: 40, reportTime: 20 },
      discoveredFacts: [
        weightFact("daysOff", 1, { kind: "seed-question", questionKey: "bidding-story" }),
        assumedFact({ dim: "landings", bucket: "zero", share: 0.9, support: 120, typicalStrength: 30, modelVersion: "v" }),
        weightFact("hotelGym", 1, { kind: "adaptive-question", questionId: "q3" }),
        weightFact("reportTime", 1, { kind: "manual-edit" }),
      ],
    });
    const after = { ...before, weights: { ...before.weights, daysOff: 90, landings: -40, hotelGym: 0, reportTime: 60, international: 30 } };
    const events = correctionEvents(before, after);
    expect(events).toEqual(
      expect.arrayContaining([
        { dim: "daysOff", src: "story", from: 70, to: 90 },
        { dim: "landings", src: "assumed", from: 0, to: -40 },
        { dim: "hotelGym", src: "asked", from: 40, to: 0 },
      ])
    );
    // A value the pilot already set by hand, or one the interview never touched, isn't a correction of the interview.
    expect(events.map((e) => e.dim)).not.toContain("reportTime");
    expect(events.map((e) => e.dim)).not.toContain("international");
    expect(parseCorrections(JSON.parse(JSON.stringify(events)))).toEqual(events);
  });

  it("rejects malformed correction batches", () => {
    expect(parseCorrections([])).toBeNull();
    expect(parseCorrections([{ dim: "daysOff", src: "manual", from: 0, to: 10 }])).toBeNull();
    expect(parseCorrections([{ dim: "daysOff", src: "asked", from: 0, to: 1000 }])).toBeNull();
    expect(parseCorrections("nope")).toBeNull();
  });

  it("never learns from the demo bid pack", () => {
    expect(isLearnablePack({ id: "sample-bidpack", month: "SAMPLE" })).toBe(false);
    expect(isLearnablePack({ id: "abc", month: "NOV26" })).toBe(true);
  });
});

describe("what the interview is handed", () => {
  const plan: InterviewPlan = {
    version: "i-20261006T09",
    groupSize: 212,
    assume: [{ dim: "landings", bucket: "zero", share: 0.91, support: 180, typicalStrength: 30 }],
    predictions: { landings: "zero", daysOff: "pos" },
    focus: [{ dim: "international", shares: { pos: 0.45, neg: 0.35, zero: 0.2 }, support: 150 }],
    productiveTopics: ["commute"],
    quietTopics: ["hotelGym"],
    targets: { "daysOff:ideal": { median: 15, low: 14, high: 16, n: 160 } },
  };

  it("is group-level guidance only, in plain words", () => {
    const insights = insightsFromPlan(plan)!;
    expect(insights.assumedFromGroup).toEqual(["landings"]);
    expect(insights.whereThisGroupSplits[0]).toEqual({ dim: "international", split: "45% lean one way, 35% the other, 20% don't care (150 pilots)" });
    expect(insights.typicalNumbers["daysOff:ideal"]).toBe("15 (most 14-16, from 160 pilots)");
  });

  it("is nothing at all before anything has been learned", () => {
    expect(insightsFromPlan(null)).toBeUndefined();
    expect(insightsFromPlan({ ...plan, version: null })).toBeUndefined();
  });
});
