import { describe, expect, it } from "vitest";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { getBidPackRanges, gymScore, rankLines } from "@/lib/scoring";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { ReviewSummary } from "@/types/hotel";

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

describe("getBidPackRanges", () => {
  it("returns real min/max spans from the sample bid pack's own line totals", () => {
    const ranges = getBidPackRanges(SAMPLE_BID_PACK);
    const daysOffValues = SAMPLE_BID_PACK.lines.map((l) => l.daysOff);
    expect(ranges.daysOff).toEqual([Math.min(...daysOffValues), Math.max(...daysOffValues)]);
    expect(ranges.creditHours[0]).toBeLessThanOrEqual(ranges.creditHours[1]);
    expect(ranges.departures[0]).toBeLessThanOrEqual(ranges.departures[1]);
  });
});
