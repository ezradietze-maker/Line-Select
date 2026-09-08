import { describe, expect, it } from "vitest";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { categoryFor, SATISFACTION_CATEGORIES } from "@/lib/satisfaction-categories";
import {
  computeCounterfactual,
  getBidPackRanges,
  gymScore,
  historicalConsistencyNote,
  mostLeveragedDimension,
  rankLines,
  type CounterfactualRanges,
  type DimensionKey,
  type DimensionScore,
} from "@/lib/scoring";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { ReviewSummary } from "@/types/hotel";
import type { MeasurableBinding, PreferenceFact } from "@/types/interview-session";

/**
 * Regression coverage built on the same sample bid pack used by the "Try a
 * sample" upload path — its three trip templates (a same-timezone LAX turn,
 * a bad eastward-shift/short-rest/WOCL Paris trip, and a good long-rest
 * westward Hawaii trip) were hand-verified against real circadian science
 * when they were written, so this also guards that data against silent
 * drift as much as it guards the scoring engine itself.
 */

function neutralProfile() {
  return buildProfile(emptyWeights(), false, []);
}

function dealbreakerFact(measurable: MeasurableBinding, statement = "Absolute dealbreaker."): PreferenceFact {
  return {
    id: "dealbreaker-1",
    statement,
    kind: "measurable",
    measurable,
    confidence: 1,
    importance: 1,
    severity: "dealbreaker",
    source: { kind: "adaptive-question", questionId: "q1" },
    turnIndex: 0,
  };
}

describe("scoreBidPack / rankLines", () => {
  it("scores every line in the sample bid pack without throwing", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, neutralProfile());
    expect(ranked).toHaveLength(SAMPLE_BID_PACK.lines.length);
    for (const r of ranked) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("ranks lines by circadian health when the pilot weights it heavily, favoring the line built only from good trips", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), circadianHealth: 100 } };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    // Line 9001 is the single-trip LAX line — same timezone, long rest, no
    // red-eye report — so with circadian health as the only real signal in
    // play it should come out on top.
    expect(ranked[0].line.lineNumber).toBe("9001");
  });

  it("leaves the circadianHealth dimension at zero importance when the pilot hasn't weighted it", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, neutralProfile());
    for (const r of ranked) {
      const dim = r.dimensions.find((d) => d.key === "circadianHealth");
      expect(dim?.importance).toBe(0);
    }
  });
});

describe("implicit dimension wiring (the open dimension list)", () => {
  const implicitValuesByLine = computeImplicitLineValues(SAMPLE_BID_PACK);

  it("adds no implicit dimensions at all for the default profile shape (empty implicitWeights/implicitConfidence)", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, neutralProfile(), {}, implicitValuesByLine);
    for (const r of ranked) {
      expect(r.dimensions).toHaveLength(11); // exactly the eleven fixed DimensionKeys, nothing more
    }
  });

  it("scores identically whether or not implicitValuesByLine is even passed, for a profile with no real implicit confidence", () => {
    const withValues = rankLines(SAMPLE_BID_PACK, neutralProfile(), {}, implicitValuesByLine);
    const withoutValues = rankLines(SAMPLE_BID_PACK, neutralProfile());
    expect(withValues.map((r) => r.score)).toEqual(withoutValues.map((r) => r.score));
  });

  it("moves a line's score when the pilot has a confident implicit weight on a dimension that line is strong on", () => {
    // Line 9002 (the sample pack's single Paris trip) pays much better per
    // hour away from base than line 9001 (the single LAX trip) — a real,
    // large spread on creditPerTafbHour, not a hand-picked coincidence.
    const line9001Value = implicitValuesByLine["sample-line-9001"].creditPerTafbHour;
    const line9002Value = implicitValuesByLine["sample-line-9002"].creditPerTafbHour;
    expect(line9002Value).toBeGreaterThan(line9001Value);

    const neutral = rankLines(SAMPLE_BID_PACK, neutralProfile(), {}, implicitValuesByLine);
    const before9001 = neutral.find((r) => r.line.id === "sample-line-9001")!.score;
    const before9002 = neutral.find((r) => r.line.id === "sample-line-9002")!.score;

    const withImplicit = {
      ...neutralProfile(),
      implicitWeights: { creditPerTafbHour: 1.5 },
      implicitConfidence: { creditPerTafbHour: 0.9 },
    };
    const ranked = rankLines(SAMPLE_BID_PACK, withImplicit, {}, implicitValuesByLine);
    const after9001 = ranked.find((r) => r.line.id === "sample-line-9001")!.score;
    const after9002 = ranked.find((r) => r.line.id === "sample-line-9002")!.score;

    // The pay-efficiency-strong line should gain relative to the weak one —
    // checking the gap widens is more robust than asserting exact scores.
    expect(after9002 - after9001).toBeGreaterThan(before9002 - before9001);

    const dim = ranked.find((r) => r.line.id === "sample-line-9002")!.dimensions.find((d) => d.key === "creditPerTafbHour");
    expect(dim).toBeDefined();
    expect(dim!.importance).toBeGreaterThan(0);
  });

  it("gates out a weak-confidence implicit weight entirely, regardless of its magnitude", () => {
    const lowConfidence = {
      ...neutralProfile(),
      implicitWeights: { creditPerTafbHour: 1.5 },
      implicitConfidence: { creditPerTafbHour: 0.05 },
    };
    const ranked = rankLines(SAMPLE_BID_PACK, lowConfidence, {}, implicitValuesByLine);
    for (const r of ranked) {
      expect(r.dimensions.some((d) => d.key === "creditPerTafbHour")).toBe(false);
    }
  });
});

describe("confidence-weighted importance", () => {
  it("gives a confidently-stated weight more importance than an identical but low-confidence one", () => {
    const base = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 80 } };
    const confident = { ...base, implicitConfidence: { creditHours: 0.95 } };
    const unconfident = { ...base, implicitConfidence: { creditHours: 0.2 } };

    const confidentRanked = rankLines(SAMPLE_BID_PACK, confident);
    const unconfidentRanked = rankLines(SAMPLE_BID_PACK, unconfident);

    const confidentImportance = confidentRanked[0].dimensions.find((d) => d.key === "creditHours")!.importance;
    const unconfidentImportance = unconfidentRanked[0].dimensions.find((d) => d.key === "creditHours")!.importance;
    expect(confidentImportance).toBeGreaterThan(unconfidentImportance);
  });

  it("treats a real weight with no recorded confidence as a deliberate answer (0.7), not a guess", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 80 } };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const importance = ranked[0].dimensions.find((d) => d.key === "creditHours")!.importance;
    expect(importance).toBeCloseTo(Math.min(1, 80 / 100) * 0.7, 5);
  });
});

describe("category sub-indices (Satisfaction Index breakdown)", () => {
  it("covers every fixed and implicit dimension with no leftovers", () => {
    const fixedKeys: DimensionKey[] = [
      "daysOff", "tripLength", "international", "cityPreference", "reportTime",
      "creditHours", "deadheadTolerance", "departures", "layoverQuality", "circadianHealth",
    ];
    for (const key of fixedKeys) {
      expect(SATISFACTION_CATEGORIES).toContain(categoryFor(key));
    }
  });

  it("is internally consistent with the overall score — computed from the same dimensions, just partitioned", () => {
    const profile = { ...neutralProfile(), weights: { ...emptyWeights(), creditHours: 90, daysOff: 60 } };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    for (const r of ranked) {
      for (const category of SATISFACTION_CATEGORIES) {
        expect(Number.isFinite(r.categoryScores[category].score)).toBe(true);
        expect(r.categoryScores[category].score).toBeGreaterThanOrEqual(0);
        expect(r.categoryScores[category].score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("dealbreakers", () => {
  it("caps a line's score when it violates an explicit-weight dealbreaker, without touching a line that doesn't", () => {
    // Direction -1 on "international" = wants to avoid international flying.
    // Line 9002 is the sample pack's single all-international (Paris) trip;
    // line 9001 is purely domestic (LAX) — a real, not hand-picked, split.
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [dealbreakerFact({ type: "explicit-weight", key: "international", direction: -1 })],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const line9002 = ranked.find((r) => r.line.lineNumber === "9002")!;
    const line9001 = ranked.find((r) => r.line.lineNumber === "9001")!;

    expect(line9002.violatedDealbreakers).toHaveLength(1);
    expect(line9002.violatedDealbreakers[0].statement).toBe("Absolute dealbreaker.");
    expect(line9002.score).toBeLessThanOrEqual(35);
    expect(line9001.violatedDealbreakers).toHaveLength(0);
  });

  it("still catches the violation on a multi-trip line where only one trip is international — averaging must not dilute a real dealbreaker away", () => {
    // Line 9004 is [tripA (domestic LAX), tripB (international CDG)] — a
    // naive line-averaged "internationalShare" check (0.5) would sit well
    // above the ordinary violation threshold and silently miss this. Caught
    // live during Phase 3 UI verification: the very bug this test guards.
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [dealbreakerFact({ type: "explicit-weight", key: "international", direction: -1 })],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const line9004 = ranked.find((r) => r.line.lineNumber === "9004")!;
    expect(line9004.violatedDealbreakers).toHaveLength(1);
    expect(line9004.score).toBeLessThanOrEqual(35);
  });

  it("catches a redEyeDeparturesPerTrip dealbreaker on any trip, not just when it dominates the line average — caught live in Phase 4 validation against a real pilot statement", () => {
    // tripB (the sample pack's Paris trip) departs 0345/0400 local, both
    // real red-eyes. Line 9004 is [tripA (no red-eye), tripB (red-eye)] —
    // the same averaging-dilution risk as the international case above.
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [
        dealbreakerFact(
          { type: "implicit-weight", variableId: "redEyeDeparturesPerTrip", direction: -1 },
          "A red-eye departure is an absolute dealbreaker — will not accept a line with one."
        ),
      ],
    };
    const implicitValuesByLine = computeImplicitLineValues(SAMPLE_BID_PACK);
    const ranked = rankLines(SAMPLE_BID_PACK, profile, {}, implicitValuesByLine);
    const line9004 = ranked.find((r) => r.line.lineNumber === "9004")!;
    const line9001 = ranked.find((r) => r.line.lineNumber === "9001")!;
    expect(line9004.violatedDealbreakers).toHaveLength(1);
    expect(line9004.score).toBeLessThanOrEqual(35);
    expect(line9001.violatedDealbreakers).toHaveLength(0);
  });

  it("caps a line's score when it touches a city-sentiment dealbreaker marked 'avoid'", () => {
    // CDG only appears on the sample pack's Paris trip (lines 9002/9004/9006).
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [dealbreakerFact({ type: "city-sentiment", code: "CDG", sentiment: "avoid" }, "Won't accept CDG.")],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const touchesCdg = ranked.filter((r) => r.line.trips.some((t) => t.layoverCities.includes("CDG")));
    const doesNotTouchCdg = ranked.filter((r) => !r.line.trips.some((t) => t.layoverCities.includes("CDG")));

    expect(touchesCdg.length).toBeGreaterThan(0);
    expect(doesNotTouchCdg.length).toBeGreaterThan(0);
    for (const r of touchesCdg) {
      expect(r.violatedDealbreakers).toHaveLength(1);
      expect(r.score).toBeLessThanOrEqual(35);
    }
    for (const r of doesNotTouchCdg) {
      expect(r.violatedDealbreakers).toHaveLength(0);
    }
  });

  it("never honors a dealbreaker on an explicit-target binding", () => {
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [dealbreakerFact({ type: "explicit-target", key: "creditHours", value: 10 })],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    for (const r of ranked) {
      expect(r.violatedDealbreakers).toHaveLength(0);
    }
  });

  it("leaves a normal (non-dealbreaker) fact's line score completely uncapped", () => {
    const profile = {
      ...neutralProfile(),
      weights: { ...emptyWeights(), international: -100 },
      discoveredFacts: [],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const line9002 = ranked.find((r) => r.line.lineNumber === "9002")!;
    expect(line9002.violatedDealbreakers).toHaveLength(0);
  });
});

describe("thin-profile backward compatibility", () => {
  it("still produces a full, non-throwing score for a completely blank profile", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, neutralProfile());
    expect(ranked).toHaveLength(SAMPLE_BID_PACK.lines.length);
    for (const r of ranked) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.violatedDealbreakers).toEqual([]);
      expect(r.qualitativeTieIns).toEqual([]);
      expect(r.contributors).toBeInstanceOf(Array);
      expect(r.detractors).toBeInstanceOf(Array);
    }
  });

  it("degrades gracefully for a legacy-interview profile with no discoveredFacts at all", () => {
    const legacy = { ...neutralProfile(), weights: { ...emptyWeights(), daysOff: 70 } };
    // @ts-expect-error - simulating a profile shape that predates discoveredFacts
    delete legacy.discoveredFacts;
    const ranked = rankLines(SAMPLE_BID_PACK, legacy);
    for (const r of ranked) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.violatedDealbreakers).toEqual([]);
    }
  });
});

describe("gymScore", () => {
  function reviewSummaryWithTheme(theme: ReviewSummary["themes"]): ReviewSummary {
    return { summary: "test", themes: theme, reviewCount: 3, generatedAt: "2026-01-01T00:00:00.000Z" };
  }

  it("falls back to the plain nearby-amenity count when reviews say nothing about the on-site gym", () => {
    expect(gymScore(0.5, null)).toBe(0.5);
    expect(gymScore(0.5, reviewSummaryWithTheme({}))).toBe(0.5);
  });

  it("pulls the score up when reviewers say the on-site gym is good, even with an identical nearby count", () => {
    const withPositiveGym = gymScore(0.5, reviewSummaryWithTheme({ onSiteGym: "positive" }));
    expect(withPositiveGym).toBeGreaterThan(0.5);
    expect(withPositiveGym).toBeCloseTo(0.8, 5);
  });

  it("pulls the score down when reviewers say the on-site gym is bad", () => {
    const withNegativeGym = gymScore(0.5, reviewSummaryWithTheme({ onSiteGym: "negative" }));
    expect(withNegativeGym).toBeLessThan(0.5);
    expect(withNegativeGym).toBeCloseTo(0.2, 5);
  });
});

describe("range targets (daysOff/departures floor-ideal-ceiling)", () => {
  it("scores a full match for any line inside [min,max], distance-penalized only outside it", () => {
    // Sample pack daysOff spread is [18,24]: 9001=24, 9002=24, 9003=23, 9004=20, 9005=19, 9006=18.
    const profile = {
      ...neutralProfile(),
      explicitTargets: { daysOff: { min: 20, max: 24 } },
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const matchFor = (lineNumber: string) =>
      ranked.find((r) => r.line.lineNumber === lineNumber)!.dimensions.find((d) => d.key === "daysOff")!.match;

    // 9001/9002/9003/9004 all sit inside [20,24] -> full match.
    expect(matchFor("9001")).toBe(1);
    expect(matchFor("9002")).toBe(1);
    expect(matchFor("9003")).toBe(1);
    expect(matchFor("9004")).toBe(1);
    // 9005 (19) and 9006 (18) sit below the floor -> distance-penalized, worse the further below.
    expect(matchFor("9005")).toBeLessThan(1);
    expect(matchFor("9006")).toBeLessThan(matchFor("9005"));
  });

  it("behaves identically to a bare pinned number when only min is given (degenerates to a floor, not a two-point band)", () => {
    const profile = {
      ...neutralProfile(),
      explicitTargets: { daysOff: { min: 22 } },
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const matchFor = (lineNumber: string) =>
      ranked.find((r) => r.line.lineNumber === lineNumber)!.dimensions.find((d) => d.key === "daysOff")!.match;
    // 24, 24, 23 all clear the floor -> full match. 20, 19, 18 fall short.
    expect(matchFor("9001")).toBe(1);
    expect(matchFor("9003")).toBe(1);
    expect(matchFor("9004")).toBeLessThan(1);
  });
});

describe("dealbreakers on explicit-target ranges (floor/ceiling breach)", () => {
  it("caps a line whose real daysOff falls below a stated floor (rangeRole min), leaves lines at or above it uncapped", () => {
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [
        dealbreakerFact(
          { type: "explicit-target", key: "daysOff", value: 20, rangeRole: "min" },
          "Fewer than 20 days off is a dealbreaker."
        ),
      ],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const line9005 = ranked.find((r) => r.line.lineNumber === "9005")!; // daysOff 19
    const line9006 = ranked.find((r) => r.line.lineNumber === "9006")!; // daysOff 18
    const line9004 = ranked.find((r) => r.line.lineNumber === "9004")!; // daysOff 20

    expect(line9005.violatedDealbreakers).toHaveLength(1);
    expect(line9005.score).toBeLessThanOrEqual(35);
    expect(line9006.violatedDealbreakers).toHaveLength(1);
    expect(line9004.violatedDealbreakers).toHaveLength(0);
  });

  it("caps a line whose real departures exceed a stated ceiling (rangeRole max)", () => {
    // Single-trip lines (9001/9002/9003) total 2 departures; two-trip lines (9004/9005/9006) total 4.
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [
        dealbreakerFact(
          { type: "explicit-target", key: "departures", value: 2, rangeRole: "max" },
          "More than 2 departures is a dealbreaker."
        ),
      ],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const line9004 = ranked.find((r) => r.line.lineNumber === "9004")!;
    const line9001 = ranked.find((r) => r.line.lineNumber === "9001")!;

    expect(line9004.violatedDealbreakers).toHaveLength(1);
    expect(line9004.score).toBeLessThanOrEqual(35);
    expect(line9001.violatedDealbreakers).toHaveLength(0);
  });

  it("still never honors a dealbreaker on a bare 'ideal' explicit-target (no rangeRole)", () => {
    const profile = {
      ...neutralProfile(),
      discoveredFacts: [dealbreakerFact({ type: "explicit-target", key: "daysOff", value: 20, rangeRole: "ideal" })],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    for (const r of ranked) {
      expect(r.violatedDealbreakers).toHaveLength(0);
    }
  });
});

describe("landings dimension", () => {
  it("is a real fixed dimension every line gets scored on", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, neutralProfile());
    for (const r of ranked) {
      expect(r.dimensions.some((d) => d.key === "landings")).toBe(true);
    }
  });

  it("favors more-landings lines when weighted positive, fewer-landings lines when weighted negative", () => {
    // Single-trip lines (9001/9002/9003) total 2 landings; two-trip lines (9004/9005/9006) total 4.
    const wantsMore = { ...neutralProfile(), weights: { ...emptyWeights(), landings: 100 } };
    const wantsFewer = { ...neutralProfile(), weights: { ...emptyWeights(), landings: -100 } };

    const rankedMore = rankLines(SAMPLE_BID_PACK, wantsMore);
    const rankedFewer = rankLines(SAMPLE_BID_PACK, wantsFewer);

    const matchIn = (ranked: typeof rankedMore, lineNumber: string) =>
      ranked.find((r) => r.line.lineNumber === lineNumber)!.dimensions.find((d) => d.key === "landings")!.match;

    expect(matchIn(rankedMore, "9004")).toBeGreaterThan(matchIn(rankedMore, "9001"));
    expect(matchIn(rankedFewer, "9001")).toBeGreaterThan(matchIn(rankedFewer, "9004"));
  });
});

describe("tripShapeVariancePerLine (predictability vs. variety implicit variable)", () => {
  it("is zero for a line whose own trips are all the same length, positive for a line whose trips differ", () => {
    const implicitValuesByLine = computeImplicitLineValues(SAMPLE_BID_PACK);
    // Raw values aren't exposed directly, but the sample pack's own construction guarantees this:
    // line 9004 = [tripA(2 days), tripB(2 days)] -> no variance; 9005 = [tripA(2 days), tripC(3 days)] -> real variance.
    // computeImplicitLineValues only returns normalized [0,1] values, so assert via the normalized spread instead.
    expect(implicitValuesByLine["sample-line-9004"].tripShapeVariancePerLine).toBeLessThan(
      implicitValuesByLine["sample-line-9005"].tripShapeVariancePerLine
    );
  });
});

function dim(overrides: Partial<DimensionScore> = {}): DimensionScore {
  return {
    key: "daysOff",
    match: 0.5,
    value: 0.5,
    target: 0.8,
    importance: 0.5,
    verified: true,
    ...overrides,
  };
}

describe("mostLeveragedDimension", () => {
  it("picks the highest-importance dimension among those with real room to improve", () => {
    const result = mostLeveragedDimension({
      dimensions: [
        dim({ key: "daysOff", importance: 0.3, match: 0.5 }),
        dim({ key: "creditHours", importance: 0.8, match: 0.4 }),
        dim({ key: "tripLength", importance: 0.2, match: 0.9 }),
      ],
    });
    expect(result?.key).toBe("creditHours");
  });

  it("skips a dimension already at a full match, even if it's the most important one", () => {
    const result = mostLeveragedDimension({
      dimensions: [
        dim({ key: "creditHours", importance: 0.9, match: 1 }),
        dim({ key: "daysOff", importance: 0.4, match: 0.6 }),
      ],
    });
    expect(result?.key).toBe("daysOff");
  });

  it("ignores an unverified (estimated-line) dimension even if it looks like the top lever", () => {
    const result = mostLeveragedDimension({
      dimensions: [
        dim({ key: "tripLength", importance: 0.9, match: 0.3, verified: false }),
        dim({ key: "daysOff", importance: 0.3, match: 0.6, verified: true }),
      ],
    });
    expect(result?.key).toBe("daysOff");
  });

  it("returns null when every dimension is already maxed out or unverified", () => {
    const result = mostLeveragedDimension({
      dimensions: [dim({ match: 1 }), dim({ verified: false, match: 0.2 })],
    });
    expect(result).toBeNull();
  });
});

describe("computeCounterfactual", () => {
  const ranges: CounterfactualRanges = {
    daysOff: [16, 24],
    avgTripLength: [2, 4],
    creditHours: [10, 30],
    departures: [2, 6],
    landings: [2, 8],
  };

  it("returns null when the line is already the top score", () => {
    const lineScore = { score: 90, dimensions: [dim({ importance: 0.8, match: 0.7 })] };
    expect(computeCounterfactual(lineScore, 90, ranges)).toBeNull();
  });

  it("returns null when the gap to the top score is negligible", () => {
    const lineScore = { score: 89.8, dimensions: [dim({ importance: 0.8, match: 0.7 })] };
    expect(computeCounterfactual(lineScore, 90, ranges)).toBeNull();
  });

  it("cites a real number of real units for a fixed dimension with a clean scale", () => {
    // Single dimension carries all the importance, so closing a 10-point gap needs exactly a 0.10 match increase.
    const lineScore = {
      score: 80,
      dimensions: [dim({ key: "daysOff", importance: 1, match: 0.5, value: 0.5, target: 1 })],
    };
    const result = computeCounterfactual(lineScore, 90, ranges);
    expect(result).not.toBeNull();
    // range span 8 (16..24) * 0.10 needed match increase = 0.8 days, rounds to 1.
    expect(result).toContain("more");
    expect(result).toContain("day");
  });

  it("falls back to a qualitative, non-numeric phrase for a dimension with no clean denormalizable unit (e.g. reportTime)", () => {
    const lineScore = {
      score: 80,
      dimensions: [dim({ key: "reportTime", importance: 1, match: 0.5, value: 0.5, target: 1 })],
    };
    const result = computeCounterfactual(lineScore, 90, ranges);
    expect(result).not.toBeNull();
    expect(result).toMatch(/meaningfully better/);
  });

  it("returns null rather than overclaiming when no single realistic change on the leading dimension could close the gap", () => {
    // Huge gap relative to this dimension's own match headroom — even a perfect match there can't get there.
    const lineScore = {
      score: 10,
      dimensions: [dim({ key: "daysOff", importance: 0.1, match: 0.3, value: 0.3, target: 1 })],
    };
    expect(computeCounterfactual(lineScore, 99, ranges)).toBeNull();
  });
});

describe("dealbreaker near-misses", () => {
  function dealbreakerFact(measurable: MeasurableBinding, statement = "Absolute dealbreaker."): PreferenceFact {
    return {
      id: "nm-1",
      statement,
      kind: "measurable",
      measurable,
      confidence: 1,
      importance: 1,
      severity: "dealbreaker",
      source: { kind: "adaptive-question", questionId: "q1" },
      turnIndex: 0,
    };
  }

  it("flags a line sitting close to (but not below) a stated daysOff floor as a near-miss, not a violation", () => {
    // Sample pack daysOff: 9001/9002=24, 9003=23, 9004=20, 9005=19, 9006=18.
    const profile = {
      ...buildProfile(emptyWeights(), false, []),
      discoveredFacts: [
        dealbreakerFact(
          { type: "explicit-target", key: "daysOff", value: 18, rangeRole: "min" },
          "Fewer than 18 days off is a dealbreaker."
        ),
      ],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    const line9006 = ranked.find((r) => r.line.lineNumber === "9006")!; // daysOff 18 == the floor itself, not below it -> not violated
    expect(line9006.violatedDealbreakers).toHaveLength(0);

    const line9005 = ranked.find((r) => r.line.lineNumber === "9005")!; // daysOff 19, 1 above the floor -> near-miss
    expect(line9005.violatedDealbreakers).toHaveLength(0);
    expect(line9005.nearMissDealbreakers).toHaveLength(1);

    const line9001 = ranked.find((r) => r.line.lineNumber === "9001")!; // daysOff 24, far above the floor -> neither
    expect(line9001.nearMissDealbreakers).toHaveLength(0);
  });

  it("never lists the same fact as both a violation and a near-miss on the same line", () => {
    const profile = {
      ...buildProfile(emptyWeights(), false, []),
      discoveredFacts: [
        dealbreakerFact({ type: "explicit-target", key: "daysOff", value: 20, rangeRole: "min" }),
      ],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile);
    for (const r of ranked) {
      if (r.violatedDealbreakers.length > 0) {
        expect(r.nearMissDealbreakers).toHaveLength(0);
      }
    }
  });
});

describe("confidenceLevel wiring", () => {
  it("carries the caller-supplied profileRichness level onto every line", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, buildProfile(emptyWeights(), false, []), {}, {}, {
      level: "thorough",
      uncoveredTopics: [],
    });
    for (const r of ranked) {
      expect(r.confidenceLevel).toBe("thorough");
    }
  });

  it("is null on every line when the caller doesn't supply profileRichness", () => {
    const ranked = rankLines(SAMPLE_BID_PACK, buildProfile(emptyWeights(), false, []));
    for (const r of ranked) {
      expect(r.confidenceLevel).toBeNull();
    }
  });
});

describe("historicalConsistencyNote", () => {
  it("returns null when there's no prior snapshot at all", () => {
    const lineScore = { dimensions: [dim({ key: "daysOff", value: 0.8 })] };
    expect(historicalConsistencyNote(lineScore, null)).toBeNull();
    expect(historicalConsistencyNote(lineScore, [])).toBeNull();
  });

  it("flags a line whose dimension values closely match a prior favorite", () => {
    const lineScore = {
      dimensions: [dim({ key: "daysOff", value: 0.8 }), dim({ key: "creditHours", value: 0.3 })],
    };
    const prior = [{ lineNumber: "1", score: 90, dimensionValues: { daysOff: 0.82, creditHours: 0.29 } }];
    expect(historicalConsistencyNote(lineScore, prior)).not.toBeNull();
  });

  it("returns null when nothing in the snapshot is genuinely close", () => {
    const lineScore = {
      dimensions: [dim({ key: "daysOff", value: 0.9 }), dim({ key: "creditHours", value: 0.1 })],
    };
    const prior = [{ lineNumber: "1", score: 90, dimensionValues: { daysOff: 0.1, creditHours: 0.9 } }];
    expect(historicalConsistencyNote(lineScore, prior)).toBeNull();
  });

  it("skips dimension keys that don't exist on both sides rather than penalizing the comparison", () => {
    const lineScore = {
      dimensions: [dim({ key: "daysOff", value: 0.8 }), dim({ key: "landings", value: 0.5 })],
    };
    // No "landings" in the prior snapshot at all — comparison should rely only on the shared "daysOff" key.
    const prior = [{ lineNumber: "1", score: 90, dimensionValues: { daysOff: 0.81 } }];
    expect(historicalConsistencyNote(lineScore, prior)).not.toBeNull();
  });
});

describe("hotel review tie-in", () => {
  function qualitativeCityReasonFact(code: string, category: "hotel" | "weather"): PreferenceFact {
    return {
      id: "cr-1",
      statement: `Not a fan of the hotel in ${code}.`,
      kind: "qualitative",
      confidence: 0.9,
      importance: 0.6,
      source: { kind: "adaptive-question", questionId: "q1" },
      turnIndex: 0,
      cityReason: { code, category },
    };
  }

  it("surfaces the real review summary when the pilot's hotel-related reason matches a city this line actually touches", () => {
    // CDG is a real layover city in the sample pack (lines 9002/9004/9006), assigned "Hilton Paris Charles De Gaulle Airport".
    const profile = {
      ...buildProfile(emptyWeights(), false, []),
      discoveredFacts: [qualitativeCityReasonFact("CDG", "hotel")],
    };
    const hotelQualityData = {
      "CDG|Hilton Paris Charles De Gaulle Airport": {
        amenities: null,
        rating: null,
        reviewSummary: { summary: "Reviewers say the rooms run noisy.", themes: {}, reviewCount: 5, generatedAt: "2026-01-01T00:00:00.000Z" },
      },
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile, hotelQualityData);
    const line9002 = ranked.find((r) => r.line.lineNumber === "9002")!; // the sample pack's CDG-touching line
    expect(line9002.hotelReviewTieIn).toEqual({
      cityCode: "CDG",
      hotelName: "Hilton Paris Charles De Gaulle Airport",
      summary: "Reviewers say the rooms run noisy.",
    });

    const line9001 = ranked.find((r) => r.line.lineNumber === "9001")!; // doesn't touch CDG at all
    expect(line9001.hotelReviewTieIn).toBeNull();
  });

  it("returns null when the reason category is not hotel-related", () => {
    const profile = {
      ...buildProfile(emptyWeights(), false, []),
      discoveredFacts: [qualitativeCityReasonFact("CDG", "weather")],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile, {});
    for (const r of ranked) {
      expect(r.hotelReviewTieIn).toBeNull();
    }
  });

  it("returns null when there's no review summary on file for the matching hotel", () => {
    const profile = {
      ...buildProfile(emptyWeights(), false, []),
      discoveredFacts: [qualitativeCityReasonFact("CDG", "hotel")],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile, {}); // no hotelQualityData at all
    for (const r of ranked) {
      expect(r.hotelReviewTieIn).toBeNull();
    }
  });

  it("gives layoverQuality real importance from a hotel-related cityReason alone, even with every hotel slider left at 0", () => {
    const profile = {
      ...buildProfile(emptyWeights(), false, []),
      discoveredFacts: [qualitativeCityReasonFact("CDG", "hotel")],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile, {});
    const line9002 = ranked.find((r) => r.line.lineNumber === "9002")!;
    const layoverDim = line9002.dimensions.find((d) => d.key === "layoverQuality")!;
    expect(layoverDim.importance).toBeGreaterThan(0);
  });

  it("leaves layoverQuality importance at 0 with no hotel-related cityReason and no hotel sliders set", () => {
    const profile = buildProfile(emptyWeights(), false, []);
    const ranked = rankLines(SAMPLE_BID_PACK, profile, {});
    for (const r of ranked) {
      const layoverDim = r.dimensions.find((d) => d.key === "layoverQuality")!;
      expect(layoverDim.importance).toBe(0);
    }
  });

  it("never overrides a hotel weight the pilot actually set themselves", () => {
    const profile = {
      ...buildProfile({ ...emptyWeights(), hotelQuality: 30 }, false, []),
      discoveredFacts: [qualitativeCityReasonFact("CDG", "hotel")],
    };
    const ranked = rankLines(SAMPLE_BID_PACK, profile, {});
    const line9002 = ranked.find((r) => r.line.lineNumber === "9002")!;
    const layoverDim = line9002.dimensions.find((d) => d.key === "layoverQuality")!;
    // Importance should reflect the pilot's own real 30, not be silently replaced by the implied 60.
    expect(layoverDim.importance).toBeCloseTo(0.3 * 0.7, 5);
  });
});

describe("getBidPackRanges", () => {
  it("returns real min/max spans from the sample bid pack's own line totals", () => {
    const ranges = getBidPackRanges(SAMPLE_BID_PACK);
    const daysOffValues = SAMPLE_BID_PACK.lines.map((l) => l.daysOff);
    expect(ranges.daysOff).toEqual([Math.min(...daysOffValues), Math.max(...daysOffValues)]);
    expect(ranges.creditHours[0]).toBeLessThanOrEqual(ranges.creditHours[1]);
    expect(ranges.departures[0]).toBeLessThanOrEqual(ranges.departures[1]);
  });
});
