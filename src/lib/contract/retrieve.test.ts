import { describe, expect, it } from "vitest";
import { expandQuestion, renderPassage, retrievePassages, searchWords } from "./retrieve";

const retrieved = (q: string) => retrievePassages(q, 40_000).passages;

describe("finding the sections for a question", () => {
  it("understands pilots' words", () => {
    expect(retrieved("how long is the sww")).toContain("25.E.6");
    expect(retrieved("what's the limit on an MUV over my bank")).toContain("7.G.5");
    expect(expandQuestion("does a carry-in hit my PNP").phrases).toEqual(expect.arrayContaining(["phase-in", "priority non-premium"]));
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

  it("stays within what it was given to spend", () => {
    const small = retrievePassages("first fly reserve assignment", 5_000).passages;
    expect(small.length).toBeGreaterThan(0);
    expect(small.length).toBeLessThan(retrieved("first fly reserve assignment").length);
  });

  it("shows the model each piece's exact id, with the 2015 words beside what changed", () => {
    const text = renderPassage("25.E.6", "2026-11");
    expect(text).toContain("[25.E.6] (not in force yet for this bid period: starts by the December 2026 bid period; the 2015 wording applies until then) Secondary Working Window");
    expect(renderPassage("25.E.6", "2026-12")).toContain("[25.E.6] (in force for this bid period");
    expect(text).toContain("[25.E.6] (2015 wording)");
    expect(text).toContain("144 hours");
  });
});
