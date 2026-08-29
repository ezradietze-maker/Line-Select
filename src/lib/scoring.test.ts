import { describe, expect, it } from "vitest";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { getBidPackRanges, rankLines } from "@/lib/scoring";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

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

describe("getBidPackRanges", () => {
  it("returns real min/max spans from the sample bid pack's own line totals", () => {
    const ranges = getBidPackRanges(SAMPLE_BID_PACK);
    const daysOffValues = SAMPLE_BID_PACK.lines.map((l) => l.daysOff);
    expect(ranges.daysOff).toEqual([Math.min(...daysOffValues), Math.max(...daysOffValues)]);
    expect(ranges.creditHours[0]).toBeLessThanOrEqual(ranges.creditHours[1]);
    expect(ranges.departures[0]).toBeLessThanOrEqual(ranges.departures[1]);
  });
});
