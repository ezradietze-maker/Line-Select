import { describe, expect, it } from "vitest";
import { describeModel, describeShape, formatRange, formatValue } from "@/lib/brain/describe";
import type { PilotModel } from "@/types/pilot-model";

describe("saying the model back in plain words", () => {
  it("formats values the way a pilot reads them", () => {
    expect(formatValue(1, { unit: "commutes" })).toBe("1 commute");
    expect(formatValue(3, { unit: "commutes" })).toBe("3 commutes");
    expect(formatValue(0.5, { unit: "share" })).toBe("50%");
    expect(formatValue(150, { unit: "minute of day" })).toBe("02:30");
    expect(formatValue(4.25, { unit: "stars (1–5, 5 easiest)" })).toBe("4.3★");
  });

  it("says each measure's value so it reads on its own, next to a priority written as a wish", () => {
    expect(formatValue(0, { id: "extraLegs", unit: "legs" })).toBe("no extra legs");
    expect(formatValue(3, { id: "extraLegs", unit: "legs" })).toBe("3 extra legs");
    expect(formatValue(1, { id: "allNighterStreak", unit: "duties" })).toBe("all-nighters one at a time");
    expect(formatValue(0, { id: "allNighterStreak", unit: "duties" })).toBe("no all-nighters");
    expect(formatValue(0, { id: "daytimeLayovers", unit: "layovers" })).toBe("a real night on every layover");
    expect(formatValue(8, { id: "longestTripDays", unit: "days" })).toBe("an 8-day longest trip");
    expect(formatValue(13, { id: "longestTripDays", unit: "days" })).toBe("a 13-day longest trip");
    expect(formatValue(11, { id: "maxDutyHours", unit: "hours" })).toBe("an 11-hour longest duty");
    expect(formatValue(4, { id: "allNighterStreak", unit: "duties" })).toBe("4 all-nighters in a row");
    expect(formatValue(4.3, { id: "avgCircadianStars", unit: "stars (1–5, 5 easiest)" })).toBe("4.3★ on the body clock");
    expect(formatValue(0.4, { id: "dayFlyingShare", unit: "share" })).toBe("40% of the flying in daytime");
    expect(formatValue(2, { id: "tripsJoinedFromHome", unit: "trips" })).toBe("2 trips with a front-end deadhead from home");
    expect(formatValue(-10, { id: "layoverValue", unit: "weighted hours" })).toBe("10 hours more in cities you avoid than in ones you like");
    expect(formatRange(0, 4, { id: "allNighterStreak", unit: "duties" })).toBe("0 to 4 all-nighters in a row");
    expect(formatRange(2, 4.3, { id: "avgCircadianStars", unit: "stars (1–5, 5 easiest)" })).toBe("2★ to 4.3★ on the body clock");
    expect(formatRange(4.9, 9.5, { id: "creditPerDayAway", unit: "hours/day" })).toBe("4.9 to 9.5 credit hours a day");
    expect(formatRange(3, 13, { id: "longestTripDays", unit: "days" })).toBe("longest trips of 3 to 13 days");
    expect(formatValue(1, { id: "avgLayoverNightHours", unit: "hours" })).toBe("1 night hour a layover");
    expect(formatValue(1, { id: "blockHours", unit: "hours" })).toBe("1 block hour");
  });

  it("describes each shape in real units", () => {
    expect(describeShape({ kind: "less", fineAt: 0 }, { unit: "duties" })).toBe("Less is better: none is ideal");
    expect(describeShape({ kind: "less", fineAt: 2, worstAt: 5 }, { id: "departureCommutes", unit: "commutes" })).toBe("Less is better: 2 commutes is fine, fewer is better still; 5 commutes or more is as bad as it gets");
    expect(describeShape({ kind: "target", ideal: 15, tolerance: 2 }, { unit: "days" })).toBe("Best around 15 days (give or take 2 days)");
    expect(describeShape({ kind: "range", min: 540 }, { unit: "minute of day" })).toBe("At least 09:00");
    expect(describeShape({ kind: "perOccurrence", costEach: 0.25 }, { unit: "duties" })).toBe("Each one costs about 25% of this priority");
  });

  it("orders priorities by their real share of the score, and states dealbreakers", () => {
    const model: PilotModel = {
      version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
      criteria: [
        { id: "a", metric: "creditHours", shape: { kind: "more" }, tier: "low", weight: 0.25, confidence: 1, label: "Pay", evidence: [], status: "settled" },
        { id: "b", metric: "requestedDatesWorked", params: { dates: ["2026-10-10"] }, shape: { kind: "less", fineAt: 0 }, tier: "must", weight: 1, confidence: 1, label: "Wedding", evidence: [{ quote: "my daughter's wedding", turn: 0 }], status: "settled", hardLimit: { op: "max", value: 0 } },
        { id: "x", metric: "noSuchMetric", shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, label: "Ghost", evidence: [], status: "settled" },
      ],
    };
    const d = describeModel(model);
    expect(d.map((c) => [c.id, c.influence])).toEqual([["b", 80], ["a", 20]]);
    expect(d[0]).toMatchObject({ measuredAs: "Wanted dates not off (2026-10-10)", dealbreaker: "Dealbreaker: any at all rules a line out", quotes: ["my daughter's wedding"] });
  });
});
