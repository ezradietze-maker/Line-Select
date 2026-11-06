import { describe, expect, it } from "vitest";
import { describeScores, scoreByVersion, type FlownCheckIn } from "./outcome-score";

const months = (n: number, brainVersion: number | null, worse: number, rank = 3): FlownCheckIn[] =>
  Array.from({ length: n }, (_, i) => ({ feel: i < worse ? "worse" : i % 2 ? "better" : "asExpected", brainVersion, awardedChoice: rank + (i % 3) }));

describe("the real-outcome score", () => {
  it("scores each brain version once it has enough flown months, newest first", () => {
    const scores = scoreByVersion([...months(10, 23, 3), ...months(12, 24, 1), ...months(4, 25, 0)]);
    expect(scores.map((s) => s.brainVersion)).toEqual([25, 24, 23]);
    expect(scores[0]).toMatchObject({ months: 4, asExpectedOrBetter: null });
    expect(scores[1].asExpectedOrBetter).toBeCloseTo(11 / 12);
    expect(scores[2].asExpectedOrBetter).toBeCloseTo(0.7);
    expect(scores[2].medianRank).toBe(4);
  });

  it("reads plainly in the weekly email", () => {
    const lines = describeScores(scoreByVersion([...months(10, 24, 2), ...months(3, null, 0)]));
    expect(lines[0]).toBe("Brain v24: 80% of 10 months flew as expected or better; the line held was typically their #4");
    expect(lines[1]).toBe("Before versions were recorded: 3 months checked in (a score shows at 10)");
    expect(describeScores([])).toEqual(["No flown months checked in yet."]);
  });
});
