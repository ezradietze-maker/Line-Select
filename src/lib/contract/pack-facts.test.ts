import { describe, expect, it } from "vitest";
import type { BidPack, Line } from "@/types/bidpack";
import { bidMonthOfPack, contractQuestionHref, linesNamed, packFacts } from "./pack-facts";

const line = (lineNumber: string): Line => ({ id: lineNumber, lineNumber, trips: [], daysOff: 14, totalCreditHours: 72.5, totalTafbHours: 200, totalLandings: 8, totalDepartures: 8 }) as Line;
const pack = { id: "p", month: "DEC26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: null, lines: [line("2016"), line("2024")] } as BidPack;

describe("what the pilot's pack adds to a question", () => {
  it("finds the lines a question names", () => {
    expect(linesNamed("would line 2016 conflict?")).toEqual(["2016"]);
    expect(linesNamed("lines 2016 and 2024, or Line #3001")).toEqual(["2016", "2024", "3001"]);
    expect(linesNamed("can I trade 2016 hours of pay?")).toEqual([]);
  });

  it("states a named line's printed figures, and only those", () => {
    const facts = packFacts("how many days off does line 2024 have?", pack)!;
    expect(facts).toContain("Line 2024 as printed: 14 days off, 72.5 CH");
    expect(facts).not.toContain("Line 2016");
    expect(facts).toContain("hasn't entered any carry-in");
  });

  it("says when a line isn't in the pack, and adds nothing to other questions", () => {
    expect(packFacts("line 9999?", pack)).toContain("Line 9999 isn't in this pack");
    expect(packFacts("how long is the SWW?", pack)).toBeUndefined();
    expect(packFacts("line 2016?", null)).toBeUndefined();
  });

  it("reads a pack's month as a bid month", () => {
    expect(bidMonthOfPack("DEC26")).toBe("2026-12");
    expect(bidMonthOfPack("oct26")).toBe("2026-10");
    expect(bidMonthOfPack("soon")).toBeNull();
  });

  it("opens the box with a question in it", () => {
    expect(contractQuestionHref("Waive 1-in-10?")).toBe(`/contract?q=${encodeURIComponent("What does the contract say about this bid question: Waive 1-in-10?")}`);
  });
});
