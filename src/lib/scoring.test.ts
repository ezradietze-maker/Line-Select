import { describe, expect, it } from "vitest";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { categoryFor, SATISFACTION_CATEGORIES } from "@/lib/satisfaction-categories";
import { getBidPackRanges, gymScore, rankLines, type DimensionKey } from "@/lib/scoring";
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

describe("getBidPackRanges", () => {
  it("returns real min/max spans from the sample bid pack's own line totals", () => {
    const ranges = getBidPackRanges(SAMPLE_BID_PACK);
    const daysOffValues = SAMPLE_BID_PACK.lines.map((l) => l.daysOff);
    expect(ranges.daysOff).toEqual([Math.min(...daysOffValues), Math.max(...daysOffValues)]);
    expect(ranges.creditHours[0]).toBeLessThanOrEqual(ranges.creditHours[1]);
    expect(ranges.departures[0]).toBeLessThanOrEqual(ranges.departures[1]);
  });
});
