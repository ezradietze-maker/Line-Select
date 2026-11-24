import { describe, expect, it } from "vitest";
import { askPackExamples } from "@/lib/ask-pack-examples";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

describe("Ask your pack's example questions", () => {
  it("asks about a city this pack really lays over in", () => {
    // The sample pack lays over in Los Angeles, Paris and Honolulu only.
    const named = askPackExamples(SAMPLE_BID_PACK)[0].match(/^Lines with (.+) and no weekends worked$/)?.[1];
    expect(["Los Angeles", "Paris", "Honolulu"]).toContain(named);
  });

  it("names the pack's most-flown city, not a fixed one", () => {
    const paris = SAMPLE_BID_PACK.lines.flatMap((l) => l.trips).find((t) => t.layoverCities.includes("CDG"))!;
    const pack = { ...SAMPLE_BID_PACK, lines: [{ ...SAMPLE_BID_PACK.lines[0], trips: [paris, paris, paris] }] };
    expect(askPackExamples(pack)[0]).toBe("Lines with Paris and no weekends worked");
  });

  it("leaves out night hub turns when the pack has none", () => {
    const pack = { ...SAMPLE_BID_PACK, lines: [] };
    expect(askPackExamples(pack)).toEqual(["Most days off, no weekends worked", "Fewest commutes, at least 15 days off", "Longest layovers and no three-leg duty periods"]);
  });
});
