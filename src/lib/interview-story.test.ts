import { describe, expect, it } from "vitest";
import { openEssentials } from "@/lib/interview-engine";
import { homeCityReasonFact, mergeStoryAndCityFacts, parseAirportCode, storyCitySentiments } from "@/lib/interview-story";
import type { PreferenceFact } from "@/types/interview-session";

function fact(id: string, overrides: Partial<PreferenceFact> = {}): PreferenceFact {
  return {
    id,
    statement: id,
    kind: "qualitative",
    confidence: 0.9,
    importance: 0.7,
    source: { kind: "seed-question", questionKey: "bidding-story" },
    turnIndex: 0,
    ...overrides,
  };
}

const lovesDen = fact("den", {
  statement: "Loves a Denver layover — it's home.",
  kind: "measurable",
  measurable: { type: "city-sentiment", code: "DEN", sentiment: "love" },
});
const daysOff = fact("days-off", { kind: "measurable", measurable: { type: "explicit-weight", key: "daysOff", direction: 1 } });

describe("storyCitySentiments", () => {
  it("returns the cities the story named, for the picker to show already marked", () => {
    expect(storyCitySentiments([lovesDen, daysOff])).toEqual({ DEN: "love" });
  });
});

describe("mergeStoryAndCityFacts", () => {
  // The real bug this guards: the city step used to replace the whole fact
  // list with the picker's facts, silently discarding everything the
  // bidding story had just extracted.
  it("keeps every non-city story fact alongside the picker's picks", () => {
    const merged = mergeStoryAndCityFacts([daysOff], { SJU: "love" });
    expect(merged.map((f) => f.id)).toContain("days-off");
    expect(merged.some((f) => f.measurable?.type === "city-sentiment" && f.measurable.code === "SJU")).toBe(true);
  });

  it("keeps the story's own wording for a city the picker still agrees with, with no duplicate", () => {
    const merged = mergeStoryAndCityFacts([lovesDen], { DEN: "love" });
    expect(merged).toEqual([lovesDen]);
  });

  it("drops a story city the pilot changed or cleared on the picker", () => {
    expect(mergeStoryAndCityFacts([lovesDen], {})).toEqual([]);
    const flipped = mergeStoryAndCityFacts([lovesDen], { DEN: "avoid" });
    expect(flipped).toHaveLength(1);
    expect(flipped[0].measurable).toEqual({ type: "city-sentiment", code: "DEN", sentiment: "avoid" });
  });
});

describe("commuter home city", () => {
  it("reads only a real 3-letter airport code", () => {
    expect(parseAirportCode(" clt ")).toBe("CLT");
    expect(parseAirportCode("Charlotte")).toBeNull();
    expect(parseAirportCode("")).toBeNull();
    expect(parseAirportCode(undefined)).toBeNull();
  });

  it("gives the home city its reason up front, so the interview doesn't ask why it's loved", () => {
    const reason = homeCityReasonFact("DEN");
    expect(reason.cityReason).toEqual({ code: "DEN", category: "people" });
    const loves = { ...reason, id: "c", kind: "measurable" as const, cityReason: undefined, measurable: { type: "city-sentiment" as const, code: "DEN", sentiment: "love" as const } };
    expect(openEssentials({ transcript: [], facts: [loves, reason], isCommuter: false })).not.toContain("city-preferences");
  });
});
