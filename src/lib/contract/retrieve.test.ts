import { describe, expect, it } from "vitest";
import { expandQuestion, renderPassage, retrievePassages, searchWords, tokens } from "./retrieve";

const retrieved = (q: string) => retrievePassages(q, 40_000).passages;

describe("finding the sections for a question", () => {
  it("understands pilots' words", () => {
    expect(retrieved("how long is the sww")).toContain("25.E.6");
    expect(retrieved("what's the limit on an MUV over my bank")).toContain("7.G.5");
    expect(expandQuestion("does a carry-in hit my PNP").phrases).toEqual(expect.arrayContaining(["phase-in", "priority non-premium"]));
    expect(retrieved("Do I get paid for a deadhead?").some((id) => id === "8.A.1" || id.startsWith("8.A.1."))).toBe(true);
  });

  it("reads a plural as its singular", () => {
    for (const [one, many] of [["line", "lines"], ["rule", "rules"], ["schedule", "schedules"], ["duty", "duties"], ["minute", "minutes"], ["box", "boxes"]]) {
      expect(tokens(many)).toEqual(tokens(one));
    }
  });

  it("never sends a passage beside one inside it", () => {
    for (const q of ["What is the bid line guarantee?", "rules for reserve lines", "what's the limit on an MUV over my bank"]) {
      const ps = retrieved(q);
      expect(ps.filter((a) => ps.some((b) => a !== b && a.startsWith(`${b}.`)))).toEqual([]);
    }
  });

  it("shows the search in the pilot's words, then the contract's", () => {
    expect(searchWords("How long is the SWW?")).toEqual(["long", "SWW", "secondary working window"]);
    expect(searchWords("what is it")).toEqual([]);
    expect(searchWords("What's the minimum rest? I can't find it")).toEqual(["minimum", "rest", "find", "rest period"]);
  });

  it("reads a follow-up with the section the last answer came from first", () => {
    const alone = retrievePassages("what about for reserves?", 40_000).passages;
    const followUp = retrievePassages("what about for reserves?", 40_000, { question: "How long is the SWW?", sections: ["25.E.6"] }).passages;
    expect(alone).not.toContain("25.E.6");
    expect(followUp[0]).toBe("25.E.6");
    expect(retrievePassages("anything", 40_000, { question: "q", sections: ["99.Z.1"] }).passages).not.toContain("99.Z.1");
  });

  it("marks a deleted paragraph as no longer the rule once its replacement is in force", () => {
    // The 75% First Fly limit, deleted by the row the chart marks as in force by hand since signing.
    expect(renderPassage("25.M.6.b", "2026-11")).toMatch(/\[25\.M\.6\.b\.iv \| 2015 wording \| replaced: no longer the rule\] i\. Reserves who elected .*75% of RLG/);
  });

  it("dates a change the implementation chart doesn't list from the Agreement's general effective date", () => {
    const text = renderPassage("4.Z", "2026-11");
    expect(text).toContain("[4.Z | in force since June 29, 2026, the Agreement's general effective date] Recall From Rest Pay");
    expect(text).toContain("[4.Z | 2015 wording | replaced: no longer the rule]");
    expect(text).not.toMatch(/\[4\.Z \| 2015 wording\]/);
    // One that waits on a later change keeps its 2015 wording as the rule until then; one the chart can't date says nothing.
    expect(renderPassage("25.L.9.a", "2026-11")).toContain("[25.L.9.a.iii | 2015 wording | still the rule for this bid period]");
    expect(renderPassage("25.E", "2026-11")).toContain("[25.E.3 | 2015 wording] Conflict Processing Window");
  });

  it("stays within what it was given to spend", () => {
    const small = retrievePassages("first fly reserve assignment", 5_000).passages;
    expect(small.length).toBeGreaterThan(0);
    expect(small.length).toBeLessThan(retrieved("first fly reserve assignment").length);
  });

  it("shows the model each piece's exact id, with the 2015 words beside what changed", () => {
    const text = renderPassage("25.E.6", "2026-11");
    expect(text).toContain("[25.E.6 | not in force yet for this bid period: starts by the December 2026 bid period; the 2015 wording applies until then] Secondary Working Window");
    expect(renderPassage("25.E.6", "2026-12")).toContain("[25.E.6 | in force for this bid period");
    expect(text).toContain("[25.E.6 | 2015 wording | still the rule for this bid period]");
    expect(renderPassage("25.E.6", "2026-12")).toContain("[25.E.6 | 2015 wording | replaced: no longer the rule]");
    expect(text).toContain("144 hours");
  });
});
