import { describe, expect, it } from "vitest";
import { applicabilityOf, currentBidMonth } from "./phases";
import { appliesLine } from "./wording";

describe("the bid month flying now, with no pack", () => {
  it("is next month's from the Monday its period starts", () => {
    expect(currentBidMonth(new Date("2026-11-29T18:00:00Z"))).toBe("2026-11");
    expect(currentBidMonth(new Date("2026-11-30T18:00:00Z"))).toBe("2026-12");
    expect(currentBidMonth(new Date("2026-10-26T18:00:00Z"))).toBe("2026-11");
    expect(currentBidMonth(new Date("2026-12-28T18:00:00Z"))).toBe("2027-01");
    expect(currentBidMonth(new Date("2026-11-11T18:00:00Z"))).toBe("2026-11");
    // Late evening in Memphis is still that day there.
    expect(currentBidMonth(new Date("2026-11-30T03:00:00Z"))).toBe("2026-11");
  });
});

describe("which bid periods a rule applies to", () => {
  it("follows the chart: Phase 2 from the December 2026 bid period", () => {
    const before = applicabilityOf("25.E.6", "2026-11");
    expect(before).toMatchObject({ kind: "scheduled", phase: 2, inForce: false });
    expect(applicabilityOf("25.E.6", "2026-12")).toMatchObject({ kind: "scheduled", phase: 2, inForce: true });
    expect(appliesLine(before, "2026")).toBe("Not yet: starts by the December 2026 bid period (Phase 2). Until then the 2015 wording applies.");
  });

  it("knows Phases 1, 3 and 4", () => {
    expect(applicabilityOf("25.F.6.a", "2026-11")).toMatchObject({ phase: 1, inForce: true });
    expect(applicabilityOf("25.L.1.a", "2027-07")).toMatchObject({ phase: 3, inForce: false });
    expect(applicabilityOf("25.L.1.a", "2027-08")).toMatchObject({ phase: 3, inForce: true });
    expect(applicabilityOf("25.C.13", "2027-09")).toMatchObject({ phase: 4, inForce: false });
  });

  it("a yellow row is in force now, by hand, until it's automated", () => {
    const disruption = applicabilityOf("25.S.2.a", "2026-11");
    expect(disruption).toMatchObject({ kind: "scheduled", phase: 2, manual: true, inForce: true, note: "pay log submission until 2" });
    expect(appliesLine(disruption, "2026")).toContain("In force since June 29, 2026, applied by hand");
  });

  it("a piece under a chart row takes that row's phase", () => {
    expect(applicabilityOf("25.C.13.a", "2026-11")).toMatchObject({ kind: "scheduled", phase: 4 });
  });

  it("a heading with changes under it lists each phase", () => {
    const heading = applicabilityOf("25.E", "2026-11");
    expect(heading.kind).toBe("mixed");
    if (heading.kind === "mixed") expect(heading.phases.map((p) => p.phase)).toEqual([2, 4]);
  });

  it("says when words didn't change, and when the chart doesn't list a change", () => {
    expect(applicabilityOf("25.A.1", "2026-11")).toEqual({ kind: "unchanged" });
    // Not on the chart: the Implementation LOA's general effective date applies.
    expect(applicabilityOf("4.Z", "2026-11")).toEqual({ kind: "unlisted" });
    expect(appliesLine({ kind: "unlisted" }, "2026")).toBe("In force since June 29, 2026, the Agreement's general effective date: the implementation chart doesn't give this change a later date.");
    expect(appliesLine({ kind: "unlisted" }, "2015")).toContain("replaced on June 29, 2026");
  });
});
