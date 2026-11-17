import { describe, expect, it } from "vitest";
import { aircraftKey, formatVipsHeader, parseVipsHeader, sameAircraft } from "@/lib/vips-header";

describe("reading the top of VIPS's bid page", () => {
  it("reads the whole line as VIPS prints it, with the bid seniority beside it", () => {
    expect(parseVipsHeader("You are bidding as a IND B767 First Officer for Flying Purposes   Current bid seniority: 3 of 45")).toEqual({
      base: "IND",
      aircraft: "B767",
      seat: "FO",
      purpose: "flying",
      position: { number: 3, of: 45 },
    });
  });

  it("reads a Captain bidding for pay purposes", () => {
    expect(parseVipsHeader("You are bidding as an ANC MD-11 Captain for Pay Purposes")).toEqual({ base: "ANC", aircraft: "MD-11", seat: "CAP", purpose: "pay" });
  });

  it("reads what a pilot types instead: domicile, fleet, seat and N of M", () => {
    expect(parseVipsHeader("MEM 767 FO 48 of 506")).toEqual({ base: "MEM", aircraft: "767", seat: "FO", position: { number: 48, of: 506 } });
    expect(parseVipsHeader("48/506")).toEqual({ position: { number: 48, of: 506 } });
  });

  it("leaves out what it can't read, and gives nothing for nothing", () => {
    expect(parseVipsHeader("")).toBeNull();
    expect(parseVipsHeader("hello there")).toBeNull();
    // A place past the size of the bid isn't one.
    expect(parseVipsHeader("60 of 45")).toBeNull();
  });

  it("never takes the seat from the bid seniority, or a base from a word like 'The'", () => {
    const h = parseVipsHeader("The bid: 3 of 45");
    expect(h?.base).toBeUndefined();
    expect(h?.seat).toBeUndefined();
  });
});

describe("one fleet, however it's written", () => {
  it("matches B767 and 767, MD-11 and MD11, and ignores a freighter's F", () => {
    expect(sameAircraft("B767", "767")).toBe(true);
    expect(sameAircraft("MD-11", "MD11")).toBe(true);
    expect(sameAircraft("B777F", "B777")).toBe(true);
    expect(sameAircraft("B767", "B757")).toBe(false);
    expect(aircraftKey("A300")).toBe("A300");
  });
});

describe("what's kept of a pasted header", () => {
  it("is only what was read, in VIPS's words, so a name or employee number pasted with it is never kept", () => {
    const pasted = "Monthly Bid Input  SMITH, JOHN  0123456  You are bidding as a IND B767 First Officer for Flying Purposes  3 of 45";
    const kept = formatVipsHeader(parseVipsHeader(pasted)!);
    expect(kept).toBe("You are bidding as a IND B767 First Officer for Flying Purposes 3 of 45");
    expect(kept).not.toMatch(/SMITH|0123456/);
    expect(parseVipsHeader(kept)).toEqual(parseVipsHeader(pasted));
  });
});
