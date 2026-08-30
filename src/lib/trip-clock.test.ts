import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  detectDateLineCrossing,
  localDayStart,
  localInstantToZulu,
  toLocalInstant,
  zuluDayLabel,
} from "@/lib/trip-clock";

describe("toLocalInstant", () => {
  it("converts a Zulu instant to real local wall-clock time at the airport", () => {
    const base = localDayStart("2024-07-02T18:00:00.000Z", "SFO")!;
    const result = toLocalInstant("2024-07-02T18:00:00.000Z", "SFO", base)!;
    expect(result.clock).toBe("11:00"); // PDT is UTC-7 in July
    expect(result.dayIndex).toBe(1);
    expect(result.zone).toBe("America/Los_Angeles");
  });

  it("numbers later days relative to the trip's own base, not calendar absolutes", () => {
    const base = localDayStart("2024-07-02T18:00:00.000Z", "SFO")!;
    const nextDay = toLocalInstant("2024-07-03T20:00:00.000Z", "SFO", base)!;
    expect(nextDay.dayIndex).toBe(2);
  });

  it("returns null for an airport with no known timezone, rather than guessing", () => {
    const base = DateTime.fromISO("2024-07-02T00:00:00.000Z", { zone: "utc" });
    expect(toLocalInstant("2024-07-02T18:00:00.000Z", "ZZZ", base)).toBeNull();
  });
});

describe("detectDateLineCrossing", () => {
  it("flags a westbound Pacific crossing as gaining a day, not just an ordinary long-flight midnight", () => {
    // SFO 11:00 Tue local -> NRT 13:30 Wed local, ~10.5h real flight.
    const crossing = detectDateLineCrossing(
      "2024-07-02T18:00:00.000Z",
      "2024-07-03T04:30:00.000Z",
      "SFO",
      "NRT"
    );
    expect(crossing).not.toBeNull();
    expect(crossing!.delta).toBe(1);
    expect(crossing!.explanation).toMatch(/1 day later/);
    expect(crossing!.explanation).toContain("NRT");
  });

  it("flags an eastbound Pacific crossing as losing a day", () => {
    // HKG 23:00 Wed local -> SFO 20:00 Wed local (same calendar day it left, despite a 12h flight).
    const crossing = detectDateLineCrossing(
      "2024-07-03T15:00:00.000Z",
      "2024-07-04T03:00:00.000Z",
      "HKG",
      "SFO"
    );
    expect(crossing).not.toBeNull();
    expect(crossing!.delta).toBe(-1);
    expect(crossing!.explanation).toMatch(/1 day earlier/);
  });

  it("never claims a compass direction ('eastbound'/'westbound') or names the date line specifically — the same day-count surprise fires on an ordinary big-offset route (e.g. transatlantic) that isn't anywhere near the antimeridian", () => {
    // CDG -> MEM, the exact pairing from sample-bidpack.ts's tripB — a real
    // ~7h offset difference, nowhere near the Pacific date line, confirmed
    // live to still trip this same detector (a "-1 day" badge on that leg).
    const crossing = detectDateLineCrossing(
      "2026-09-01T17:45:00.000Z",
      "2026-09-02T02:45:00.000Z",
      "CDG",
      "MEM"
    );
    expect(crossing).not.toBeNull();
    expect(crossing!.explanation).not.toMatch(/eastbound|westbound|date line/i);
  });

  it("reports nothing for an ordinary domestic hop with no real date-line effect", () => {
    // SFO -> LAX, both America/Los_Angeles, same day either way.
    const crossing = detectDateLineCrossing(
      "2024-07-02T18:00:00.000Z",
      "2024-07-02T19:15:00.000Z",
      "SFO",
      "LAX"
    );
    expect(crossing).toBeNull();
  });

  it("reports nothing for an ordinary long domestic overnight that crosses a ONE midnight but not because of timezone", () => {
    // A late-night SFO->LAX repositioning that just happens to cross local midnight — same zone both ends, so any day change is purely duration, not a date-line effect.
    const crossing = detectDateLineCrossing(
      "2024-07-03T06:30:00.000Z", // 23:30 Tue PDT
      "2024-07-03T07:45:00.000Z", // 00:45 Wed PDT
      "SFO",
      "LAX"
    );
    expect(crossing).toBeNull();
  });

  it("returns null when either airport's timezone is unknown", () => {
    expect(
      detectDateLineCrossing("2024-07-02T18:00:00.000Z", "2024-07-03T04:30:00.000Z", "SFO", "ZZZ")
    ).toBeNull();
  });
});

describe("localInstantToZulu", () => {
  it("is the exact inverse of toLocalInstant for the same day/minute/zone", () => {
    const base = localDayStart("2024-07-02T18:00:00.000Z", "SFO")!;
    const original = "2024-07-03T20:00:00.000Z";
    const local = toLocalInstant(original, "SFO", base)!;
    const roundTripped = localInstantToZulu(local.dayIndex, local.minuteOfDay, "SFO", base);
    expect(roundTripped).toBe(original);
  });

  it("returns null for an unknown airport", () => {
    const base = localDayStart("2024-07-02T18:00:00.000Z", "SFO")!;
    expect(localInstantToZulu(1, 0, "ZZZ", base)).toBeNull();
  });
});

describe("zuluDayLabel", () => {
  it("labels an instant's Zulu day index relative to the trip's anchor", () => {
    const anchor = "2024-07-02T00:00:00.000Z";
    expect(zuluDayLabel("2024-07-02T18:00:00.000Z", anchor)).toEqual({ dayIndex: 1, clock: "18:00" });
    expect(zuluDayLabel("2024-07-04T03:00:00.000Z", anchor)).toEqual({ dayIndex: 3, clock: "03:00" });
  });
});
