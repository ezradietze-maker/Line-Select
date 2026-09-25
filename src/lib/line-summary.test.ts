import { describe, expect, it } from "vitest";
import { buildLineFactChips, lineFactsText } from "@/lib/line-summary";
import type { Line, Trip } from "@/types/bidpack";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

function line(over: Partial<Line> = {}, cities: string[] = []): Line {
  const trip = { id: "t", layoverCities: cities, days: 3 } as unknown as Trip;
  return { id: "l", lineNumber: "1105", trips: [trip], daysOff: 15, totalCreditHours: 83.87, totalTafbHours: 0, totalLandings: 0, totalDepartures: 8, totalDutyPeriods: 8, ...over };
}

function profile(over: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    deepRoundCompleted: true,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter: null,
    hasCrashPad: null,
    cityPreferences: {},
    completedAt: "2026-01-01T00:00:00.000Z",
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts: [],
    interviewTranscript: [],
    ...over,
  };
}

describe("buildLineFactChips", () => {
  it("shows the real numbers with no comparison when the pilot pinned nothing", () => {
    const chips = buildLineFactChips(line(), profile());
    expect(chips.map((c) => c.main)).toEqual(["15 days off", "8 duty periods", "8 departures", "83:52 credit"]);
    expect(chips.every((c) => c.tone === "neutral" && c.note === "")).toBe(true);
  });

  it("frames days off against a stated range — inside it is good, outside is a warning", () => {
    const p = profile({ explicitTargets: { daysOff: { min: 12, ideal: 14, max: 16 } } });
    expect(buildLineFactChips(line({ daysOff: 15 }), p)[0]).toMatchObject({ tone: "good", note: "in your 12–16" });
    expect(buildLineFactChips(line({ daysOff: 11 }), p)[0]).toMatchObject({ tone: "warn", note: "below your 12 minimum" });
    expect(buildLineFactChips(line({ daysOff: 18 }), p)[0]).toMatchObject({ tone: "warn", note: "over your 16 max" });
  });

  it("treats a bare pinned number as an ideal with a small tolerance", () => {
    const p = profile({ explicitTargets: { dutyPeriods: 8 } });
    expect(buildLineFactChips(line({ totalDutyPeriods: 9 }), p)[1]).toMatchObject({ tone: "good", note: "right at your 8" });
    expect(buildLineFactChips(line({ totalDutyPeriods: 12 }), p)[1]).toMatchObject({ tone: "neutral", note: "you wanted 8" });
  });

  it("names the specific loved and avoided cities on THIS line, and only those", () => {
    const p = profile({ cityPreferences: { HNL: "love", ANC: "avoid", CDG: "avoid" } });
    const chips = buildLineFactChips(line({}, ["HNL", "ANC", "LAX"]), p);
    expect(chips.map((c) => c.main)).toContain("♥ HNL");
    expect(chips.map((c) => c.main)).toContain("✕ ANC");
    expect(chips.map((c) => c.main)).not.toContain("✕ CDG");
    expect(chips.find((c) => c.main === "✕ ANC")?.tone).toBe("warn");
  });

  it("gives different lines different chips — the whole point", () => {
    const p = profile({ explicitTargets: { daysOff: { min: 14, max: 16 } }, cityPreferences: { HNL: "love" } });
    const a = lineFactsText(buildLineFactChips(line({ daysOff: 15 }, ["HNL"]), p));
    const b = lineFactsText(buildLineFactChips(line({ daysOff: 13 }, ["LAX"]), p));
    expect(a).not.toBe(b);
  });
});
