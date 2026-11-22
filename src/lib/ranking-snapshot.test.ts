import { describe, expect, it } from "vitest";
import { linesToOffer, type RankingSnapshot } from "@/lib/ranking-snapshot";

const lines = ["2001", "2002", "2003", "2004"].map((n) => ({ id: `l${n}`, lineNumber: n }));
// A non-member's snapshot holds only the lines they see: their top ten (here two).
const snapshot: RankingSnapshot = { bidPackId: "p", byLineId: new Map([["l2003", { rank: 1, score: 97.3 }], ["l2001", { rank: 2, score: 95.1 }]]) };

describe("linesToOffer", () => {
  it("offers every line of the pack to a member", () => {
    expect(linesToOffer(lines, snapshot, false).map((l) => l.lineNumber)).toEqual(["2001", "2002", "2003", "2004"]);
  });

  it("offers a non-member only the lines they can see, their top ten", () => {
    // ⌘K listed every line by number, though picking one past the ten opened nothing.
    expect(linesToOffer(lines, snapshot, true).map((l) => l.lineNumber)).toEqual(["2001", "2003"]);
  });

  it("offers a non-member no line before their ranking is worked out", () => {
    expect(linesToOffer(lines, null, true)).toEqual([]);
  });
});
