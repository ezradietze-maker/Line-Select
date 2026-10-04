import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPreviousPeriodSnapshot,
  saveBidPeriodSnapshot,
  summarizeBidPeriodChange,
} from "@/lib/bid-period-history";
import type { LineScore } from "@/lib/scoring";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Only `line.lineNumber` and `score` are ever read by this module — a minimal fixture, not a real scored line. */
function fakeScore(lineNumber: string, score: number): LineScore {
  return { line: { lineNumber }, score } as unknown as LineScore;
}

describe("bid period history", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("finds no previous period on a pilot's first time here", () => {
    expect(loadPreviousPeriodSnapshot(null, "SEP26")).toBeNull();
  });

  it("does not treat refining the same month as a new bid period", () => {
    saveBidPeriodSnapshot(null, "SEP26", [fakeScore("1001", 90)]);
    saveBidPeriodSnapshot(null, "SEP26", [fakeScore("1001", 92)]);
    expect(loadPreviousPeriodSnapshot(null, "SEP26")).toBeNull();
  });

  it("finds a genuinely earlier month once one is on record", () => {
    saveBidPeriodSnapshot(null, "AUG26", [fakeScore("1001", 90)]);
    const found = loadPreviousPeriodSnapshot(null, "SEP26");
    expect(found?.month).toBe("AUG26");
    expect(found?.ranked[0]).toEqual({ lineNumber: "1001", rank: 1, score: 90 });
  });

  it("keeps per-account history separate from guest history", () => {
    saveBidPeriodSnapshot("user-1", "AUG26", [fakeScore("2001", 80)]);
    expect(loadPreviousPeriodSnapshot(null, "SEP26")).toBeNull();
    expect(loadPreviousPeriodSnapshot("user-1", "SEP26")?.ranked[0].lineNumber).toBe("2001");
  });

  describe("summarizeBidPeriodChange", () => {
    it("is null with nothing real to compare", () => {
      expect(summarizeBidPeriodChange(null, [fakeScore("1001", 90)])).toBeNull();
    });

    it("reports the same top line held, with both scores", () => {
      saveBidPeriodSnapshot(null, "AUG26", [fakeScore("1001", 85)]);
      const previous = loadPreviousPeriodSnapshot(null, "SEP26");
      const summary = summarizeBidPeriodChange(previous, [fakeScore("1001", 90), fakeScore("1002", 70)]);
      expect(summary).toEqual({
        previousMonth: "AUG26",
        currentTopLine: "1001",
        currentTopScore: 90,
        previousTopLine: "1001",
        previousTopScore: 85,
        sameTopLine: true,
        previousTopLineNowRank: 1,
      });
    });

    it("reports a changed top line, and where the old top line landed this time", () => {
      saveBidPeriodSnapshot(null, "AUG26", [fakeScore("1001", 85)]);
      const previous = loadPreviousPeriodSnapshot(null, "SEP26");
      const summary = summarizeBidPeriodChange(previous, [fakeScore("1002", 95), fakeScore("1001", 60)]);
      expect(summary?.sameTopLine).toBe(false);
      expect(summary?.currentTopLine).toBe("1002");
      expect(summary?.previousTopLine).toBe("1001");
      expect(summary?.previousTopLineNowRank).toBe(2);
    });

    it("says the old top line isn't in this bid pack at all, rather than guessing a rank", () => {
      saveBidPeriodSnapshot(null, "AUG26", [fakeScore("1001", 85)]);
      const previous = loadPreviousPeriodSnapshot(null, "SEP26");
      const summary = summarizeBidPeriodChange(previous, [fakeScore("1002", 95)]);
      expect(summary?.previousTopLineNowRank).toBeNull();
    });
  });
});
