import { describe, expect, it } from "vitest";
import {
  EMPTY_MARKS,
  PAGE_SIZE,
  bidOrderLines,
  hideLine,
  leftOutPhrase,
  matchesLineSearch,
  nextVisibleCount,
  pruneMarks,
  restoreLine,
  stepCursor,
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

describe("the order an export takes", () => {
  const ranked = ["9001", "9002", "9003", "9004", "9005"].map((n, i) => ls(n, 90 - i));

  it("is the whole ranked order, whatever the list is narrowed to, less the hidden and Not bid lines", () => {
    const out = bidOrderLines(ranked, new Set(["line-9002"]), new Set(["line-9004", "line-9002"]));
    expect(out.lines.map((r) => r.line.lineNumber)).toEqual(["9001", "9003", "9005"]);
    // 9002 is both hidden and Not bid: counted once.
    expect(out).toMatchObject({ hidden: 0, notBid: 2 });
    expect(bidOrderLines(ranked, new Set(), new Set()).lines).toHaveLength(5);
  });

  it("says what it left out", () => {
    expect(leftOutPhrase(0, 0)).toBeNull();
    expect(leftOutPhrase(1, 0)).toBe("the line you hid");
    expect(leftOutPhrase(2, 1)).toBe("the 2 lines you hid and the Not bid line");
    expect(leftOutPhrase(0, 3)).toBe("the 3 Not bid lines");
  });
});

describe("the j / k cursor", () => {
  it("stays on its line when the line moves, and steps from wherever it went", () => {
    // Line c was third; a tier key sent it to the top.
    expect(stepCursor(["c", "a", "b", "d"], "c", 1)).toBe("a");
    expect(stepCursor(["a", "b", "d", "c"], "c", -1)).toBe("d");
  });

  it("starts at the top, and stops at either end", () => {
    expect(stepCursor(["a", "b"], null, 1)).toBe("a");
    expect(stepCursor(["a", "b"], "gone", -1)).toBe("a");
    expect(stepCursor(["a", "b"], "b", 1)).toBe("b");
    expect(stepCursor(["a", "b"], "a", -1)).toBe("a");
    expect(stepCursor([], "a", 1)).toBeNull();
  });
});
