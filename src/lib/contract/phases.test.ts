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

  it("gives a change the chart doesn't list the date of the later one it waits on", () => {
    // "…processed as provided in Section 25.L.1.a." (2015: "…notwithstanding Section 25.L.1.a."); 25.L.1.a is Phase 3.
    expect(applicabilityOf("25.L.9.a.iii", "2026-11")).toMatchObject({ kind: "scheduled", phase: 3, inForce: false });
    expect(applicabilityOf("25.L.10.c", "2027-08")).toMatchObject({ kind: "scheduled", phase: 3, inForce: true });
    // "Following the three additional bid periods…", which 8.C.2.a.ii (Phase 2) sets up.
    expect(applicabilityOf("8.C.2.a.iii", "2026-11")).toMatchObject({ kind: "scheduled", phase: 2, inForce: false });
    // By rule: the 2026 wording newly adds "(except as provided in Section 25.L.1.a. above)".
    expect(applicabilityOf("25.L.4.b", "2026-11")).toMatchObject({ kind: "scheduled", phase: 3 });
    const waits = applicabilityOf("25.L.9.a.iii", "2026-11");
    expect(appliesLine(waits, "2026")).toBe("Not yet: starts by the August 2027 bid period (Phase 3). Until then the 2015 wording applies. Not on the chart itself: it waits on Section 25.L.1.a.");
    // A renumbered reference isn't waiting on anything.
    expect(applicabilityOf("5.E.6", "2026-11")).toEqual({ kind: "unlisted" });
  });

  it("lists, above a change that waits on a later one, that change's phase", () => {
    // 25.L.10's only change is 25.L.10.c: not "in force since June 29, 2026".
    expect(applicabilityOf("25.L.10", "2026-11")).toEqual({ kind: "mixed", phases: [{ phase: 3, startsLabel: "the August 2027 bid period", refs: ["25.L.10.c"] }] });
    const refsOf = (id: string, phase: number) => {
      const a = applicabilityOf(id, "2026-11");
      return a.kind === "mixed" ? (a.phases.find((p) => p.phase === phase)?.refs ?? []) : [];
    };
    expect(refsOf("25.L.4", 3)).toEqual(["25.L.4.b"]);
    expect(refsOf("25.L.9.a", 3)).toEqual(["25.L.9.a.iii"]);
    expect(refsOf("8.C.2.a", 2)).toEqual(["8.C.2.a.ii", "8.C.2.a.iii"]);
    expect(refsOf("25.L", 3)).toEqual(expect.arrayContaining(["25.L.1.a", "25.L.4.b", "25.L.5.a", "25.L.6.a", "25.L.9.a.iii", "25.L.10.c"]));
  });

  it("says the chart doesn't date a change that may belong with a later one", () => {
    expect(applicabilityOf("25.E.3", "2026-11")).toEqual({ kind: "undated" });
    expect(applicabilityOf("8.C.5.a.ii", "2026-11")).toEqual({ kind: "undated" });
    expect(appliesLine({ kind: "undated" }, "2026")).toContain("doesn't say when this wording starts");
  });
});
