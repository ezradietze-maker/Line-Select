import { describe, expect, it } from "vitest";
import { applyPilotFacts, parsePilotFacts } from "@/lib/brain/pilot-facts";
import { withHomeFacts } from "@/lib/brain/model-upgrade";
import type { PilotModel } from "@/types/pilot-model";

const model = (home: PilotModel["home"]): PilotModel => ({ version: 2, home, criteria: [], threads: [], notMeasurable: [], synopsis: "" });

describe("pilot facts", () => {
  it("keeps only the facts given, in a sane range, with the pilot's words for each", () => {
    const f = parsePilotFacts({
      minHomeHours: 24,
      hasCrashPad: "unknown",
      evidence: [{ fact: "minHomeHours", quote: "if I can be home 24 hours I go home", turn: 3 }, { fact: "hasCrashPad", quote: "?", turn: 1 }, { fact: "made-up", quote: "x", turn: 0 }],
    });
    expect(f.values).toEqual({ minHomeHours: 24 });
    expect(f.evidence).toEqual([{ fact: "minHomeHours", quote: "if I can be home 24 hours I go home", turn: 3 }]);
    expect(parsePilotFacts({ minHomeHours: -1, hasCrashPad: "no", evidence: [] }).values).toEqual({ hasCrashPad: false });
    expect(parsePilotFacts({ minHomeHours: 900, hasCrashPad: "yes", evidence: "nope" }).values).toEqual({ hasCrashPad: true });
  });

  it("reads cities whose grade moves with the season, and drops ones it can't use", () => {
    const f = parsePilotFacts({
      minHomeHours: -1,
      hasCrashPad: "unknown",
      citySeasons: [
        { city: "anc", season: "summer", months: [], change: 1 },
        { city: "ANC", season: "winter", months: [1], change: -1 },
        { city: "HNL", season: "months", months: [8, 6, 7, 7, 13], change: -0.5 },
        { city: "HNL", season: "months", months: [], change: -0.5 },
        { city: "Phoenix", season: "summer", months: [], change: -2 },
        { city: "BOS", season: "winter", months: [], change: 0 },
      ],
      evidence: [{ fact: "citySeasons", quote: "an Anchorage layover in the summer is great", turn: 0 }],
    });
    expect(f.citySeasons).toEqual([
      { city: "ANC", season: "summer", months: [], change: 1 },
      { city: "ANC", season: "winter", months: [], change: -1 },
      { city: "HNL", season: "months", months: [6, 7, 8], change: -0.5 },
    ]);
    expect(f.evidence).toHaveLength(1);
    // Kept for a pilot with no known home too.
    expect(applyPilotFacts(model(null), f).facts?.citySeasons).toHaveLength(3);
  });

  it("reads places whose hotels would change a city's grade, and drops ones no address can show", () => {
    const f = parsePilotFacts({
      citySeasons: [],
      hotelAreas: [
        { city: "oak", places: ["Pleasanton", "Dublin", "San Ramon", "Dublin", " "], change: 1, longLayovers: true },
        { city: "EWR", places: ["New York, NY"], change: 0.5 },
        { city: "IAH", places: [], change: 1 },
        { city: "JFK", places: ["Manhattan"], change: 0 },
      ],
      evidence: [{ fact: "hotelAreas", quote: "over the hill in Pleasanton, Dublin, or San Ramon", turn: 4 }],
    });
    expect(f.hotelAreas).toEqual([
      { city: "OAK", places: ["Pleasanton", "Dublin", "San Ramon"], change: 1, longLayovers: true },
      { city: "EWR", places: ["New York, NY"], change: 0.5, longLayovers: false },
    ]);
    expect(f.evidence).toHaveLength(1);
  });

  it("puts them where the app reads them, and the pilot's own answers on the commute screen still win", () => {
    const read = applyPilotFacts(model({ airports: ["SAN"], commuter: true }), { values: { minHomeHours: 36, hasCrashPad: true }, evidence: [] });
    expect(read.home).toMatchObject({ minHomeHours: 36, hasCrashPad: true });
    expect(read.facts?.values).toEqual({ minHomeHours: 36, hasCrashPad: true });
    expect(withHomeFacts(read, { minHomeHours: 24, hasCrashPad: false }).home).toMatchObject({ minHomeHours: 24, hasCrashPad: false });
    // No known home, no home facts.
    const none = model(null);
    expect(applyPilotFacts(none, { values: { minHomeHours: 24 }, evidence: [] })).toBe(none);
  });
});
