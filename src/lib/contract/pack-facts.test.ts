import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CarryInItem, FlownLine, PhaseInFinding } from "@/lib/phase-in";
import type { BidPack, Line, Trip } from "@/types/bidpack";

const fly = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/lib/phase-in", async (real) => ({ ...(await real<typeof import("@/lib/phase-in")>()), flyLine: vi.fn(() => fly.result) }));

const { bidMonthOfPack, contractQuestionHref, linesNamed, packFacts, tripsNamed } = await import("./pack-facts");

const line = (lineNumber: string): Line => ({ id: lineNumber, lineNumber, trips: [], daysOff: 14, totalCreditHours: 72.5, totalTafbHours: 200, totalLandings: 8, totalDepartures: 8 }) as Line;
const pack = { id: "p", month: "DEC26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: null, lines: [line("2016"), line("2024")] } as BidPack;

const carryIn: CarryInItem[] = [{ kind: "trip", id: "c", label: "Trip 213", report: "2026-11-29T10:00:00Z", release: "2026-12-01T10:00:00Z", international: false }];
const finding = (over: Partial<PhaseInFinding>): PhaseInFinding => ({ tripId: "t", pairingNumber: "301", rule: "rest", section: "CBA 2026 25.F.1.b", detail: "reports 6.5 hours after Trip 213 ends; the legal rest is 9:30", certainty: "clear", waivedBy: null, waived: false, ...over });
const flown = (over: Partial<FlownLine>): FlownLine => ({ line: line("2016"), unchecked: false, dropped: [], kept: [], makeUpCH: 0, daysOffBefore: 14, daysOffAfter: 12, longestOffBefore: null, longestOffAfter: null, minDays: null, advice: [], reason: null, ...over });

describe("a named line against the pilot's carry-in", () => {
  beforeEach(() => {
    fly.result = flown({});
  });

  it("states a dropped trip, why and the section it stands on", () => {
    fly.result = flown({ dropped: [{ trip: { pairingNumber: "301" } as Trip, makeUpCH: 18.5, findings: [finding({})] }] });
    const facts = packFacts("would line 2016 conflict with my carry-in?", pack, carryIn)!;
    expect(facts).toContain("trip 301 is dropped, 18.5 CH to make up");
    expect(facts).toContain("the legal rest is 9:30 (CBA 2026 25.F.1.b)");
    expect(facts).toContain("Line 2016 days off after carry-in: 12");
    expect(facts).not.toContain("hasn't entered");
  });

  it("tells a waived conflict from one the contract's text leaves unclear", () => {
    fly.result = flown({ kept: [finding({ waived: true }), finding({ certainty: "check", pairingNumber: "302" })] });
    const facts = packFacts("line 2016?", pack, carryIn)!;
    expect(facts).toContain("waived on the bid: trip 301");
    expect(facts).toContain("unclear in the contract text, so left on the line: trip 302");
  });

  it("says when nothing conflicts, and when it couldn't check", () => {
    expect(packFacts("line 2016?", pack, carryIn)).toContain("no conflict found");
    fly.result = flown({ unchecked: true });
    const facts = packFacts("line 2016?", pack, carryIn)!;
    expect(facts).toContain("weren't checked");
    expect(facts).not.toContain("no conflict");
  });
});

describe("what the pilot's pack adds to a question", () => {
  it("finds the lines a question names", () => {
    expect(linesNamed("would line 2016 conflict?")).toEqual(["2016"]);
    expect(linesNamed("lines 2016 and 2024, or Line #3001")).toEqual(["2016", "2024", "3001"]);
    expect(linesNamed("can I trade 2016 hours of pay?")).toEqual([]);
    expect(linesNamed("Can a line 120 hours long be built? Do lines 100 CH or more get extra pay? A line 200-hour TAFB?")).toEqual([]);
    expect(linesNamed("does line 1800 still post? and line 2016 changes?")).toEqual(["1800", "2016"]);
    expect(tripsNamed("trip 301 checks out")).toEqual(["301"]);
  });

  it("states a named line's printed figures, and only those", () => {
    const facts = packFacts("how many days off does line 2024 have?", pack)!;
    expect(facts).toContain("Line 2024 as printed: 14 days off, 72.5 CH");
    expect(facts).not.toContain("Line 2016");
    expect(facts).toContain("hasn't entered any carry-in");
  });

  it("says a named trip is in the pack only when it is, and never reads a count of days as a trip", () => {
    expect(tripsNamed("can I drop trip 301, or trips 302 and 4410?")).toEqual(["301", "302", "4410"]);
    expect(tripsNamed("do trips 3 days long count? what about a trip 4-day?")).toEqual([]);
    const withTrips = { ...pack, lines: [{ ...line("2016"), trips: [{ pairingNumber: "301" } as Trip] }] } as BidPack;
    const facts = packFacts("can I drop trip 301 or trip 999?", withTrips)!;
    expect(facts).toContain("Trip 301 is in this pack.");
    expect(facts).not.toContain("999");
    expect(facts).not.toContain("carry-in");
    expect(packFacts("do trips 3 days long count?", withTrips)).toBeUndefined();
    expect(packFacts("can I drop trip 999?", withTrips)).toBeUndefined();
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
