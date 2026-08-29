import { describe, expect, it } from "vitest";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import {
  learnFromReorder,
  reinforceVariable,
  topImplicitContributions,
  topJudgmentFactors,
  type PairwiseJudgment,
} from "@/lib/rank-learning";
import { rankLines } from "@/lib/scoring";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { PreferenceProfile } from "@/types/preferences";

function neutralProfile(): PreferenceProfile {
  return buildProfile(emptyWeights(), false, []);
}

/** Real LineScore objects from the real scoring engine — not hand-built fixtures, so every dimension's `verified` flag and value are exactly what the app itself would produce. */
function rankedLines(profile: PreferenceProfile) {
  return rankLines(SAMPLE_BID_PACK, profile);
}

const implicitValuesByLine = computeImplicitLineValues(SAMPLE_BID_PACK);

describe("learnFromReorder", () => {
  it("moves creditHours weight upward when the pilot favors the higher-credit line", () => {
    const profile = neutralProfile();
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!; // 36 credit hours
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!; // 7.5 credit hours

    const judgment: PairwiseJudgment = { favored: highCredit, overtaken: lowCredit };
    const result = learnFromReorder(profile, implicitValuesByLine, [judgment]);

    expect(result.weights.creditHours).toBeGreaterThan(profile.weights.creditHours);
  });

  it("moves the weight the opposite direction when the preference is reversed", () => {
    const profile = neutralProfile();
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!;
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!;

    const judgment: PairwiseJudgment = { favored: lowCredit, overtaken: highCredit };
    const result = learnFromReorder(profile, implicitValuesByLine, [judgment]);

    expect(result.weights.creditHours).toBeLessThan(profile.weights.creditHours);
  });

  it("raises confidence for a dimension whose new evidence agrees with its existing direction", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 40 } };
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!;
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!;

    const result = learnFromReorder(profile, implicitValuesByLine, [
      { favored: highCredit, overtaken: lowCredit },
    ]);
    const update = result.updates.find((u) => u.id === "creditHours")!;
    expect(update.confidenceAfter).toBeGreaterThan(update.confidenceBefore);
  });

  it("erodes confidence faster than it grows when new evidence contradicts the existing direction", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 40 } };
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!;
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!;

    // Contradicts the existing positive creditHours weight by favoring the *lower*-credit line.
    const contradicting = learnFromReorder(profile, implicitValuesByLine, [
      { favored: lowCredit, overtaken: highCredit },
    ]).updates.find((u) => u.id === "creditHours")!;
    const agreeing = learnFromReorder(profile, implicitValuesByLine, [
      { favored: highCredit, overtaken: lowCredit },
    ]).updates.find((u) => u.id === "creditHours")!;

    const contradictingDrop = contradicting.confidenceBefore - contradicting.confidenceAfter;
    const agreeingGain = agreeing.confidenceAfter - agreeing.confidenceBefore;
    expect(contradictingDrop).toBeGreaterThan(agreeingGain);
  });

  it("skips a dimension entirely when both lines are unverified for it, rather than fabricating a comparison", () => {
    // Every SAMPLE_BID_PACK line has estimated: false, so force one line
    // into the unverified shape to exercise the guard directly.
    const profile = neutralProfile();
    const ranked = rankedLines(profile);
    const a = ranked[0];
    const b = ranked[1];
    const unverifiedA = {
      ...a,
      dimensions: a.dimensions.map((d) => (d.key === "tripLength" ? { ...d, verified: false } : d)),
    };
    const result = learnFromReorder(profile, implicitValuesByLine, [
      { favored: unverifiedA, overtaken: b },
    ]);
    expect(result.updates.some((u) => u.id === "tripLength")).toBe(false);
  });

  it("never proposes a weight outside a dimension's own floor/ceiling, even after a strongly one-sided judgment", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 95 } };
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!;
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!;
    const result = learnFromReorder(profile, implicitValuesByLine, [
      { favored: highCredit, overtaken: lowCredit },
    ]);
    expect(result.weights.creditHours).toBeLessThanOrEqual(100);
    expect(result.weights.creditHours).toBeGreaterThanOrEqual(-100);
  });

  it("clamps a magnitude-only dimension's floor at 0, never letting it go negative", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), hotelQuiet: 5 } };
    const ranked = rankedLines(profile);
    // Find two lines whose layoverQuality hotelBreakdown.quiet genuinely differs, if any exist in this sample pack.
    const withBreakdown = ranked.filter((r) => {
      const lq = r.dimensions.find((d) => d.key === "layoverQuality");
      return lq?.hotelBreakdown?.quiet !== null && lq?.hotelBreakdown?.quiet !== undefined;
    });
    if (withBreakdown.length < 2) return; // sample pack has no hotel review data configured — nothing to test here
    const result = learnFromReorder(profile, implicitValuesByLine, [
      { favored: withBreakdown[1], overtaken: withBreakdown[0] },
    ]);
    expect(result.weights.hotelQuiet).toBeGreaterThanOrEqual(0);
  });

  it("merges repeated judgments about the same dimension into a single update spanning first-before to last-after", () => {
    const profile = neutralProfile();
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!;
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!;
    const judgment: PairwiseJudgment = { favored: highCredit, overtaken: lowCredit };

    const result = learnFromReorder(profile, implicitValuesByLine, [judgment, judgment, judgment]);
    const updates = result.updates.filter((u) => u.id === "creditHours");
    expect(updates).toHaveLength(1);
    expect(updates[0].weightBefore).toBe(profile.weights.creditHours);
  });

  it("picks the single most surprising judgment across several, largest prediction error first", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 90 } };
    const ranked = rankedLines(profile);
    const highCredit = ranked.find((r) => r.line.lineNumber === "9006")!;
    const lowCredit = ranked.find((r) => r.line.lineNumber === "9001")!;

    // The model already strongly expects high-credit to beat low-credit
    // (unsurprising) — but the reverse judgment directly contradicts a
    // confident weight, so it should be flagged as the more surprising one.
    const expected: PairwiseJudgment = { favored: highCredit, overtaken: lowCredit };
    const surprising: PairwiseJudgment = { favored: lowCredit, overtaken: highCredit };

    const result = learnFromReorder(profile, implicitValuesByLine, [expected, surprising]);
    expect(result.mostSurprising).toBe(surprising);
  });
});

describe("reinforceVariable", () => {
  it("moves an explicit dimension's weight in the given direction and sets high confidence", () => {
    const profile = neutralProfile();
    const updated = reinforceVariable(profile, "creditHours", 1);
    expect(updated.weights.creditHours).toBeGreaterThan(profile.weights.creditHours);
    expect(updated.implicitConfidence.creditHours).toBeGreaterThanOrEqual(0.8);
  });

  it("never pushes a magnitude-only dimension below its 0 floor", () => {
    const profile = neutralProfile();
    const updated = reinforceVariable(profile, "hotelQuiet", -1);
    expect(updated.weights.hotelQuiet).toBeGreaterThanOrEqual(0);
  });

  it("never lowers confidence that's already above the reinforcement's own baseline", () => {
    const profile = {
      ...neutralProfile(),
      implicitConfidence: { creditHours: 0.95 },
    };
    const updated = reinforceVariable(profile, "creditHours", 1);
    expect(updated.implicitConfidence.creditHours).toBe(0.95);
  });

  it("creates a new implicit weight from scratch and marks it confidently learned", () => {
    const profile = neutralProfile();
    const updated = reinforceVariable(profile, "redEyeDeparturesPerTrip", 1);
    expect(updated.implicitWeights.redEyeDeparturesPerTrip).toBeGreaterThan(0);
    expect(updated.implicitConfidence.redEyeDeparturesPerTrip).toBeGreaterThanOrEqual(0.8);
  });
});

describe("topJudgmentFactors", () => {
  it("orders real per-trip differences largest-gap first and caps at the requested limit", () => {
    const profile = neutralProfile();
    const ranked = rankedLines(profile);
    const judgment: PairwiseJudgment = {
      favored: ranked.find((r) => r.line.lineNumber === "9006")!,
      overtaken: ranked.find((r) => r.line.lineNumber === "9001")!,
    };
    const factors = topJudgmentFactors(judgment, profile, implicitValuesByLine, 2);
    expect(factors.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i - 1].gap).toBeGreaterThanOrEqual(factors[i].gap);
    }
  });
});

describe("topImplicitContributions", () => {
  it("excludes a dimension below the confidence-to-explain bar, even with a real weight", () => {
    const profile = {
      ...neutralProfile(),
      implicitWeights: { redEyeDeparturesPerTrip: 1 },
      implicitConfidence: { redEyeDeparturesPerTrip: 0.05 },
    };
    const lineId = SAMPLE_BID_PACK.lines[0].id;
    const contributions = topImplicitContributions(lineId, implicitValuesByLine, profile, 5);
    expect(contributions.some((c) => c.id === "redEyeDeparturesPerTrip")).toBe(false);
  });

  it("includes a confidently-learned dimension with a real non-zero weight, sorted by contribution size", () => {
    const profile = {
      ...neutralProfile(),
      implicitWeights: { redEyeDeparturesPerTrip: 1, avgTurnTimeMinutes: 0.5 },
      implicitConfidence: { redEyeDeparturesPerTrip: 0.9, avgTurnTimeMinutes: 0.9 },
    };
    const lineId = SAMPLE_BID_PACK.lines[0].id;
    const contributions = topImplicitContributions(lineId, implicitValuesByLine, profile, 5);
    for (let i = 1; i < contributions.length; i++) {
      expect(Math.abs(contributions[i - 1].contribution)).toBeGreaterThanOrEqual(
        Math.abs(contributions[i].contribution)
      );
    }
  });
});
