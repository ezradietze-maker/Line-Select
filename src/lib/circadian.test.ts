import { describe, expect, it } from "vitest";
import { computeCumulativeCircadianAssessment, computeHomeBaseOffsetMinutes, hasRealTripPlacement } from "@/lib/circadian";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * Placeholder Zulu instant for every leg fixture below — circadian.ts
 * derives its own offsets from each leg's printed depTimeLocal/depTimeGmt
 * pair, never from depTimeZulu/zuluAnchor, so these just need to satisfy
 * the type, not be individually meaningful.
 */
const Z = "2024-01-01T00:00:00.000Z";

/** A single-duty stub trip — enough shape for computeCircadianAssessment to run on, with everything not relevant to the assertion at hand set to a neutral value. */
function stubTrip(overrides: Partial<Trip> & { schedule: Trip["schedule"] }): Trip {
  return {
    id: "t",
    pairingNumber: "1",
    days: 2,
    layoverCities: [],
    layoverDetails: [],
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: 10,
    landings: 2,
    tafbHours: 24,
    departures: 2,
    zuluAnchor: Z,
    startDayIndex: null,
    ...overrides,
  };
}

function stubBidPack(base: string, trip: Trip): BidPack {
  return {
    id: "bp",
    month: "TEST",
    base,
    aircraft: "77",
    seat: "CAP",
    bidPeriodDays: 28,
    bidPeriodStart: null,
    lines: [{ id: "l1", lineNumber: "1", trips: [trip], daysOff: 20, totalCreditHours: 10, totalTafbHours: 24, totalLandings: 2, totalDepartures: 2 }],
  };
}

describe("computeHomeBaseOffsetMinutes", () => {
  it("derives the real UTC offset from a leg's own local/GMT time pair", () => {
    // MEM at UTC-5: a leg departing MEM at 15:00 local prints 20:00 GMT for the same instant.
    const trip = stubTrip({
      schedule: [
        {
          reportTimeLocal: "1400",
          startMinutes: 0,
          legs: [
            { flightNumber: "1", equipment: "77", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1500", depTimeGmt: "2000", arrAirport: "LAX", arrTimeLocal: "1630", arrTimeGmt: "2330", blockHours: 3.5, startMinutes: 60, endMinutes: 270, depTimeZulu: Z, arrTimeZulu: Z },
          ],
          layover: null,
        },
      ],
    });
    expect(computeHomeBaseOffsetMinutes(stubBidPack("MEM", trip))).toBe(-300);
  });

  it("returns null when no trip in the bid pack has a verified leg departing home base", () => {
    const trip = stubTrip({ schedule: [] });
    expect(computeHomeBaseOffsetMinutes(stubBidPack("MEM", trip))).toBeNull();
  });
});

/**
 * `n` night duties in a row, 22:00–06:00 Memphis time, each a night apart — legs with their real printed times, so the
 * body-clock score can place them: a run this long is a rough trip.
 */
function nightRunTrip(n: number, overrides: Partial<Trip> = {}): Trip {
  const hhmm = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
  // Trip minute 0 is the first report, 21:00 Memphis (02:00 UTC).
  const leg = (start: number) => ({ flightNumber: "1", equipment: "M1", isDeadhead: false, depAirport: "MEM", depTimeLocal: hhmm(start + 21 * 60), depTimeGmt: hhmm(start + 26 * 60), arrAirport: "MEM", arrTimeLocal: hhmm(start + 29 * 60), arrTimeGmt: hhmm(start + 34 * 60), blockHours: 8, startMinutes: start, endMinutes: start + 480, depTimeZulu: Z, arrTimeZulu: Z });
  return stubTrip({
    id: `night${n}`,
    schedule: Array.from({ length: n }, (_, i) => ({
      reportTimeLocal: "2100",
      startMinutes: i * 1440,
      legs: [leg(i * 1440 + 60)],
      layover: i < n - 1 ? { city: "MEM", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: (1440 - 540) / 60, startMinutes: i * 1440 + 540, endMinutes: (i + 1) * 1440 } : null,
    })),
    ...overrides,
  });
}

describe("hasRealTripPlacement", () => {
  it("is false when bidPeriodStart is null, even with every trip's startDayIndex set", () => {
    expect(hasRealTripPlacement([stubTrip({ schedule: [], startDayIndex: 0 })], null)).toBe(false);
  });

  it("is false when any trip's startDayIndex is null", () => {
    const trips = [stubTrip({ schedule: [], startDayIndex: 0 }), stubTrip({ schedule: [], startDayIndex: null })];
    expect(hasRealTripPlacement(trips, "2026-01-01")).toBe(false);
  });

  it("is true only when bidPeriodStart exists and every trip has a real startDayIndex", () => {
    const trips = [stubTrip({ schedule: [], startDayIndex: 0 }), stubTrip({ schedule: [], startDayIndex: 5 })];
    expect(hasRealTripPlacement(trips, "2026-01-01")).toBe(true);
  });
});

describe("computeCumulativeCircadianAssessment", () => {
  it("returns null when trip placement isn't confirmed real, never an approximated gap", () => {
    const trips = [
      stubTrip({ schedule: [{ reportTimeLocal: "1400", startMinutes: 0, legs: [], layover: null }], startDayIndex: null, days: 2 }),
      stubTrip({ schedule: [{ reportTimeLocal: "1400", startMinutes: 0, legs: [], layover: null }], startDayIndex: null, days: 2 }),
    ];
    expect(computeCumulativeCircadianAssessment(trips, -300, null)).toBeNull();
    expect(computeCumulativeCircadianAssessment(trips, -300, "2026-01-01")).toBeNull(); // startDayIndex still null on both
  });

  it("reports 'only one trip' with no gap to assess when the line has a single trip", () => {
    const trips = [stubTrip({ schedule: [{ reportTimeLocal: "1400", startMinutes: 0, legs: [], layover: null }], startDayIndex: 0, days: 2 })];
    const result = computeCumulativeCircadianAssessment(trips, -300, "2026-01-01");
    expect(result).toEqual({ tightestRecoveryGapDays: null, hasCompoundingRisk: false, summary: expect.stringContaining("Only one trip") });
  });

  it("computes the real day-off gap between two trips from their startDayIndex/days", () => {
    // Trip A: days 0-1 (2 days). Trip B starts day 5 -> gap = 5 - (0+2) = 3 real days off.
    const trips = [
      stubTrip({ schedule: [{ reportTimeLocal: "1400", startMinutes: 0, legs: [], layover: null }], startDayIndex: 0, days: 2 }),
      stubTrip({ schedule: [{ reportTimeLocal: "1400", startMinutes: 0, legs: [], layover: null }], startDayIndex: 5, days: 2 }),
    ];
    const result = computeCumulativeCircadianAssessment(trips, -300, "2026-01-01");
    expect(result!.tightestRecoveryGapDays).toBe(3);
  });

  it("flags compounding risk when two meaningfully disruptive trips sit closer together than a real recovery window", () => {
    // Six nights in a row: a rough trip on the body clock (well under the disruptive score).
    const closeTrips = [nightRunTrip(6, { startDayIndex: 0, days: 6 }), nightRunTrip(6, { startDayIndex: 7, days: 6 })]; // 1 real day off
    const farTrips = [nightRunTrip(6, { startDayIndex: 0, days: 6 }), nightRunTrip(6, { startDayIndex: 14, days: 6 })]; // 8 real days off

    expect(computeCumulativeCircadianAssessment(closeTrips, -300, "2026-01-01")!.hasCompoundingRisk).toBe(true);
    expect(computeCumulativeCircadianAssessment(farTrips, -300, "2026-01-01")!.hasCompoundingRisk).toBe(false);
  });
});
