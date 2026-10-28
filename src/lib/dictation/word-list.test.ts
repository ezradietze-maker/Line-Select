import { describe, expect, it } from "vitest";
import type { BidPack } from "@/types/bidpack";
import { MAX_TERMS, dictationWords, fixSpelledCodes, packAirports, spokenAircraft } from "./word-list";

const trip = (layoverCities: string[]) => ({ layoverCities }) as unknown as BidPack["lines"][number]["trips"][number];
const pack = {
  base: "MEM",
  aircraft: "MD11",
  lines: [
    { trips: [trip(["OAK", "HNL"]), trip(["OAK"])] },
    { trips: [trip(["YYZ"]), trip(["OAK", "YYZ"])] },
  ],
} as unknown as BidPack;

describe("dictation word list", () => {
  it("says the aircraft the way a pilot does", () => {
    expect(spokenAircraft("MD11")).toBe("MD-11");
    expect(spokenAircraft("B777")).toBe("777");
    expect(spokenAircraft("A300")).toBe("A300");
  });

  it("lists the base first, then layover airports most-flown first", () => {
    expect(packAirports(pack)).toEqual(["MEM", "OAK", "YYZ", "HNL"]);
    expect(packAirports(null)).toEqual([]);
  });

  it("holds the pilot words, the aircraft, and each airport as code and city, within the limit", () => {
    const list = dictationWords(pack);
    expect(list).toEqual(expect.arrayContaining(["double deadhead", "jumpseat", "hub turn", "MD-11", "MEM", "Memphis", "OAK", "Oakland", "YYZ", "Toronto"]));
    expect(list.length).toBeLessThanOrEqual(MAX_TERMS);
    expect(new Set(list.map((t) => t.toLowerCase())).size).toBe(list.length);
    expect(list.some((t) => t.includes("/"))).toBe(false);
  });

  it("works without a pack", () => {
    expect(dictationWords(null)).toContain("double deadhead");
  });
});

describe("fixSpelledCodes", () => {
  const codes = ["MEM", "YYZ", "EWR"];
  it("joins a pack airport said letter by letter", () => {
    expect(fixSpelledCodes("commute into M E M today", codes)).toBe("commute into MEM today");
    expect(fixSpelledCodes("I like Y-Y-Z and e.w.r. layovers", codes)).toBe("I like YYZ and EWR layovers");
  });

  it("keeps the period that ends a sentence", () => {
    expect(fixSpelledCodes("Never commute into M E M.", codes)).toBe("Never commute into MEM.");
  });

  it("leaves letters that aren't a pack airport alone", () => {
    expect(fixSpelledCodes("A B C and I a m here", codes)).toBe("A B C and I a m here");
    expect(fixSpelledCodes("L A X is close", codes)).toBe("L A X is close");
  });
});
