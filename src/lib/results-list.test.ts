import { describe, expect, it } from "vitest";
import {
  EMPTY_MARKS,
  PAGE_SIZE,
  hideLine,
  matchesLineSearch,
  nextVisibleCount,
  pruneMarks,
  restoreLine,
  toggleStar,
} from "@/lib/results-list";
import type { LineScore } from "@/lib/scoring";
import type { Line } from "@/types/bidpack";

function ls(lineNumber: string, score: number, over: Partial<Line> = {}): LineScore {
  return {
    line: { id: `line-${lineNumber}`, lineNumber, trips: [], daysOff: 15, totalCreditHours: 80, totalTafbHours: 0, totalLandings: 0, totalDepartures: 8, ...over },
    score,
  } as unknown as LineScore;
}

describe("matchesLineSearch", () => {
  const line = ls("1105", 1).line;
  it("matches exact, partial and prefixed forms", () => {
    expect(matchesLineSearch(line, "1105")).toBe(true);
    expect(matchesLineSearch(line, "110")).toBe(true);
    expect(matchesLineSearch(line, "line 1105")).toBe(true);
    expect(matchesLineSearch(line, "#1105")).toBe(true);
  });
  it("rejects a different number and accepts an empty query", () => {
    expect(matchesLineSearch(line, "2105")).toBe(false);
    expect(matchesLineSearch(line, "   ")).toBe(true);
  });
});

describe("paging", () => {
  it("grows by one page and stops at the total", () => {
    expect(nextVisibleCount(PAGE_SIZE, 283)).toBe(PAGE_SIZE * 2);
    expect(nextVisibleCount(275, 283)).toBe(283);
  });
});

describe("star / hide marks", () => {
  it("stars, un-stars, and hiding a starred line removes the star", () => {
    let m = toggleStar(EMPTY_MARKS, "a");
    expect(m.starred).toEqual(["a"]);
    m = hideLine(m, "a");
    expect(m).toEqual({ starred: [], hidden: ["a"] });
    m = toggleStar(m, "a");
    expect(m).toEqual({ starred: ["a"], hidden: [] });
    expect(toggleStar(m, "a").starred).toEqual([]);
  });

  it("restores a hidden line and never double-hides", () => {
    let m = hideLine(hideLine(EMPTY_MARKS, "a"), "a");
    expect(m.hidden).toEqual(["a"]);
    m = restoreLine(m, "a");
    expect(m.hidden).toEqual([]);
  });

  it("prunes marks that belong to a different bid pack", () => {
    const m = pruneMarks({ starred: ["a", "x"], hidden: ["b", "y"] }, new Set(["a", "b"]));
    expect(m).toEqual({ starred: ["a"], hidden: ["b"] });
  });
});
