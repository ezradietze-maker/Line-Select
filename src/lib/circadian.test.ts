import { describe, expect, it } from "vitest";
import {
  computeCircadianAssessment,
  computeCumulativeCircadianAssessment,
  computeHomeBaseOffsetMinutes,
  hasRealTripPlacement,
} from "@/lib/circadian";
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

describe("computeCircadianAssessment", () => {
  it("returns null for a trip with no verified schedule", () => {
    expect(computeCircadianAssessment(stubTrip({ schedule: [] }), -300)).toBeNull();
  });

  it("returns null when the bid pack's home-base offset couldn't be derived", () => {
    const trip = stubTrip({
      schedule: [{ reportTimeLocal: "1400", startMinutes: 0, legs: [], layover: null }],
    });
    expect(computeCircadianAssessment(trip, null)).toBeNull();
  });

  it("scores a same-timezone trip with real rest and no red-eye report as minimal disruption", () => {
    // MEM(-5) -> ATL(-5): zero shift, 20h layover, no report in the 02:00-05:59 window.
    const trip = stubTrip({
      schedule: [
        {
          reportTimeLocal: "1400",
          startMinutes: 0,
          legs: [{ flightNumber: "1", equipment: "77", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1500", depTimeGmt: "2000", arrAirport: "ATL", arrTimeLocal: "1630", arrTimeGmt: "2130", blockHours: 1.5, startMinutes: 60, endMinutes: 150, depTimeZulu: Z, arrTimeZulu: Z }],
          layover: { city: "ATL", hotelName: "Test Hotel", transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: 150, endMinutes: 1350 },
        },
        {
          reportTimeLocal: "1030",
          startMinutes: 1350,
          legs: [{ flightNumber: "2", equipment: "77", isDeadhead: false, depAirport: "ATL", depTimeLocal: "1115", depTimeGmt: "1615", arrAirport: "MEM", arrTimeLocal: "1130", arrTimeGmt: "1630", blockHours: 1.25, startMinutes: 1425, endMinutes: 1500, depTimeZulu: Z, arrTimeZulu: Z }],
          layover: null,
        },
      ],
    });
    const result = computeCircadianAssessment(trip, -300);
    expect(result).not.toBeNull();
    expect(result!.stars).toBe(5);
    expect(result!.timezoneShiftHours).toBe(0);
    expect(result!.wocEncroachments).toBe(0);
    expect(result!.shortRestCount).toBe(0);
  });

  it("penalizes a report inside the 02:00-05:59 Window of Circadian Low", () => {
    const withoutWocl = stubTrip({
      schedule: [{ reportTimeLocal: "0900", startMinutes: 0, legs: [{ flightNumber: "1", equipment: "77", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1000", depTimeGmt: "1500", arrAirport: "MEM", arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 1, startMinutes: 60, endMinutes: 120, depTimeZulu: Z, arrTimeZulu: Z }], layover: null }],
    });
    const withWocl = stubTrip({
      schedule: [{ reportTimeLocal: "0300", startMinutes: 0, legs: [{ flightNumber: "1", equipment: "77", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1000", depTimeGmt: "1500", arrAirport: "MEM", arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 1, startMinutes: 60, endMinutes: 120, depTimeZulu: Z, arrTimeZulu: Z }], layover: null }],
    });
    const clean = computeCircadianAssessment(withoutWocl, -300)!;
    const dirty = computeCircadianAssessment(withWocl, -300)!;
    expect(dirty.wocEncroachments).toBe(1);
    expect(clean.wocEncroachments).toBe(0);
    expect(dirty.stars).toBeLessThanOrEqual(clean.stars);
  });

  it("penalizes a layover under the FAA Part 117 10-hour rest floor", () => {
    const trip = stubTrip({
      schedule: [
        {
          reportTimeLocal: "1400",
          startMinutes: 0,
          legs: [{ flightNumber: "1", equipment: "77", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1500", depTimeGmt: "2000", arrAirport: "ATL", arrTimeLocal: "1630", arrTimeGmt: "2130", blockHours: 1.5, startMinutes: 60, endMinutes: 150, depTimeZulu: Z, arrTimeZulu: Z }],
          layover: { city: "ATL", hotelName: "Test Hotel", transportToHotel: null, transportFromHotel: null, hours: 7, startMinutes: 150, endMinutes: 570 },
        },
        {
          reportTimeLocal: "1130",
          startMinutes: 570,
          legs: [{ flightNumber: "2", equipment: "77", isDeadhead: false, depAirport: "ATL", depTimeLocal: "1215", depTimeGmt: "1715", arrAirport: "MEM", arrTimeLocal: "1230", arrTimeGmt: "1730", blockHours: 1.25, startMinutes: 630, endMinutes: 705, depTimeZulu: Z, arrTimeZulu: Z }],
          layover: null,
        },
      ],
    });
    const result = computeCircadianAssessment(trip, -300)!;
    expect(result.shortRestCount).toBe(1);
  });

  it("scores an eastward shift as more disruptive than the same-magnitude westward shift — the real phase-advance/phase-delay asymmetry", () => {
    function tripWithDestOffset(destOffsetMinutes: number): Trip {
      // Construct a leg whose printed local/GMT pair implies the given destination offset, landing at a plain midday time so only the shift (not WOCL) is in play.
      const gmtMinutes = 16 * 60; // arbitrary anchor instant, 16:00 GMT
      const localMinutes = ((gmtMinutes + destOffsetMinutes) % 1440 + 1440) % 1440;
      const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
      return stubTrip({
        schedule: [
          {
            reportTimeLocal: "1400",
            startMinutes: 0,
            legs: [{ flightNumber: "1", equipment: "77", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1500", depTimeGmt: "2000", arrAirport: "XXX", arrTimeLocal: toHHMM(localMinutes), arrTimeGmt: toHHMM(gmtMinutes), blockHours: 5, startMinutes: 60, endMinutes: 360, depTimeZulu: Z, arrTimeZulu: Z }],
            layover: { city: "XXX", hotelName: "Test Hotel", transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: 360, endMinutes: 1560 },
          },
          {
            reportTimeLocal: "1200",
            startMinutes: 1560,
            legs: [{ flightNumber: "2", equipment: "77", isDeadhead: false, depAirport: "XXX", depTimeLocal: "1245", depTimeGmt: "1245", arrAirport: "MEM", arrTimeLocal: "1330", arrTimeGmt: "1330", blockHours: 5, startMinutes: 1620, endMinutes: 1920, depTimeZulu: Z, arrTimeZulu: Z }],
            layover: null,
          },
        ],
      });
    }

    // Home base MEM at -300 (UTC-5). A destination 6h east (+60) vs 6h west (-660, i.e. -11h, which normalizes to +... ) — use symmetric +/-6h around home offset directly instead.
    const homeOffset = -300;
    const eastward = computeCircadianAssessment(tripWithDestOffset(homeOffset + 6 * 60), homeOffset)!;
    const westward = computeCircadianAssessment(tripWithDestOffset(homeOffset - 6 * 60), homeOffset)!;

    expect(eastward.timezoneShiftHours).toBeGreaterThan(0);
    expect(westward.timezoneShiftHours).toBeLessThan(0);
    expect(Math.abs(eastward.timezoneShiftHours)).toBeCloseTo(Math.abs(westward.timezoneShiftHours), 1);
    // Same magnitude, opposite direction — eastward must score no better than westward.
    expect(eastward.stars).toBeLessThanOrEqual(westward.stars);
  });
});

/** N duty periods, all reporting inside the 02:00-05:59 WOCL window, back to back — legs/layover left empty since only reportTimeLocal matters for this streak. */
function woclStreakTrip(streakLength: number, overrides: Partial<Trip> = {}): Trip {
  return stubTrip({
    schedule: Array.from({ length: streakLength }, (_, i) => ({
      reportTimeLocal: "0300",
      startMinutes: i * 1440,
      legs: [],
      layover: null,
    })),
    ...overrides,
  });
}

describe("computeCircadianAssessment — personalized consecutive-WOCL tolerance", () => {
  it("behaves exactly like the generic Math.min(wocEncroachments, 3) cap when no tolerance is given", () => {
    const result = computeCircadianAssessment(woclStreakTrip(2), -300)!;
    expect(result.wocEncroachments).toBe(2);
    expect(result.stars).toBe(4); // penalty 2 -> "<=3" bucket
  });

  it("scores a WOCL streak comfortably within a stated tolerance more gently than the generic default", () => {
    const generic = computeCircadianAssessment(woclStreakTrip(2), -300)!;
    const tolerant = computeCircadianAssessment(woclStreakTrip(2), -300, 3)!;
    expect(tolerant.stars).toBeGreaterThan(generic.stars);
  });

  it("scores a WOCL streak that exceeds a stated tolerance more harshly than the generic default", () => {
    const generic = computeCircadianAssessment(woclStreakTrip(3), -300)!;
    const intolerant = computeCircadianAssessment(woclStreakTrip(3), -300, 0)!;
    expect(intolerant.stars).toBeLessThan(generic.stars);
  });

  it("names the pilot's own stated tolerance in the summary once it's exceeded and the biggest factor", () => {
    const result = computeCircadianAssessment(woclStreakTrip(3), -300, 1)!;
    expect(result.summary).toMatch(/you said you can handle/);
  });
});

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
    // A 4-long WOCL streak with 0 stated tolerance reuses the already-verified
    // personalization math above to reliably land at 2 stars (penalty 8: 0
    // within-tolerance + 4 reports * 2 over-tolerance) — well inside the
    // DISRUPTIVE_STAR_THRESHOLD (<=2), without needing a separately
    // hand-engineered timezone/rest fixture.
    const closeTrips = [
      woclStreakTrip(4, { startDayIndex: 0, days: 2 }),
      woclStreakTrip(4, { startDayIndex: 3, days: 2 }), // gap = 3 - (0+2) = 1 real day off
    ];
    const farTrips = [
      woclStreakTrip(4, { startDayIndex: 0, days: 2 }),
      woclStreakTrip(4, { startDayIndex: 10, days: 2 }), // gap = 10 - (0+2) = 8 real days off
    ];

    const closeResult = computeCumulativeCircadianAssessment(closeTrips, -300, "2026-01-01", 0);
    const farResult = computeCumulativeCircadianAssessment(farTrips, -300, "2026-01-01", 0);

    expect(closeResult!.hasCompoundingRisk).toBe(true);
    expect(farResult!.hasCompoundingRisk).toBe(false);
  });
});
