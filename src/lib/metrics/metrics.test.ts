import { describe, expect, it } from "vitest";
import { measure, prepareMetrics } from "@/lib/metrics/compute";
import { DEFAULT_HOME_PARAMS, homeAwayForTrip } from "@/lib/metrics/home-travel";
import { computeTripFacts, deepNightOverlapMinutes, nightOverlapHours, regionOf } from "@/lib/metrics/trip-facts";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";

/**
 * A trip with everything a commuter's bidding turns on: it opens with an
 * airline deadhead ANC→LAX (a commuter from southern California can skip the base),
 * sits 30 hours before flying, works a three-leg duty, lays over 36 hours in
 * Guangzhou and 20 in Honolulu, and closes with a deadhead home after a
 * 24-hour sit.
 */
function leg(fn: string, from: string, to: string, start: number, end: number, extra: Partial<TripLeg> = {}): TripLeg {
  const clock = (m: number) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}${String(x % 60).padStart(2, "0")}`;
  };
  return {
    flightNumber: fn, equipment: fn.match(/^\d/) ? "77" : "JET", isDeadhead: !/^\d+$/.test(fn), depAirport: from, arrAirport: to,
    depTimeLocal: clock(start + 600), depTimeGmt: clock(start), arrTimeLocal: clock(end + 600), arrTimeGmt: clock(end),
    blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "", ...extra,
  };
}

const trip: Trip = {
  id: "t1", pairingNumber: "501", days: 7, layoverCities: ["LAX", "CAN", "HNL"], layoverDetails: [], reportTime: "early", international: true,
  deadheadLegs: 2, creditHours: 40, landings: 4, tafbHours: 160, departures: 4, zuluAnchor: "2026-10-01T00:00:00.000Z", startDayIndex: 0,
  schedule: [
    // Duty 1: front deadhead ANC→LAX, then a 30h layover in LAX.
    { reportTimeLocal: "0800", startMinutes: 0, legs: [leg("AS100", "ANC", "LAX", 60, 360)], layover: { city: "LAX", hotelName: "Hotel A", transportToHotel: null, transportFromHotel: null, hours: 30, startMinutes: 360, endMinutes: 2160 } },
    // Duty 2: three operated legs LAX→ANC→ICN→CAN, then 36h in CAN.
    {
      reportTimeLocal: "0700", startMinutes: 2160,
      legs: [leg("101", "LAX", "ANC", 2220, 2520), leg("102", "ANC", "ICN", 2580, 3120), leg("103", "ICN", "CAN", 3180, 3420)],
      layover: { city: "CAN", hotelName: "Hotel B", transportToHotel: null, transportFromHotel: null, hours: 36, startMinutes: 3420, endMinutes: 5580 },
    },
    // Duty 3: one leg CAN→HNL, 20h in HNL.
    { reportTimeLocal: "0700", startMinutes: 5580, legs: [leg("104", "CAN", "HNL", 5640, 6240)], layover: { city: "HNL", hotelName: "Hotel C", transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: 6240, endMinutes: 7440 } },
    // Duty 4: deadhead home HNL→ANC after the layover (the back-end slack is the 20h layover).
    { reportTimeLocal: "0700", startMinutes: 7440, legs: [leg("HA200", "HNL", "ANC", 7500, 7860)], layover: null },
  ],
};

const line: Line = { id: "L1", lineNumber: "1001", trips: [trip], daysOff: 14, totalCreditHours: 80, totalTafbHours: 160, totalLandings: 4, totalDepartures: 4 };
const pack = { id: "p", month: "OCT26", base: "ANC", aircraft: "B777", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as unknown as BidPack;
const metrics = prepareMetrics(pack);

describe("trip facts", () => {
  const f = computeTripFacts(trip);

  it("sees the deadhead at each end, where the flying starts and stops, and the slack around it", () => {
    expect(f.front?.city).toBe("LAX");
    expect(f.front?.slackHours).toBeCloseTo(31, 5); // 06:00 arrival to 37:00 first operated departure
    expect(f.back?.city).toBe("HNL");
    expect(f.back?.slackHours).toBeCloseTo(21, 5);
  });

  it("counts operated legs per duty, not deadheads", () => {
    expect(f.duties.map((d) => d.operatedLegs)).toEqual([0, 3, 1, 0]);
  });

  it("places each layover in its region", () => {
    expect(f.layovers.map((l) => [l.city, l.region])).toEqual([["LAX", "domestic"], ["CAN", "asia"], ["HNL", "hawaii"]]);
    expect(regionOf("SYD")).toBe("oceania");
  });

  it("measures how much of a layover falls in the local night", () => {
    expect(nightOverlapHours(20 * 60, 12)).toBeCloseTo(9, 5); // 20:00 → 08:00 covers 22:00–07:00
    expect(nightOverlapHours(9 * 60, 10)).toBe(0);
  });
});

describe("metric library", () => {
  const m = (id: string, params = {}) => measure(id, line, metrics, params);

  it("counts three-leg duties the way a pilot means it", () => {
    expect(m("dutiesWithManyLegs")).toBe(1);
    expect(m("dutiesWithManyLegs", { n: 2 })).toBe(1);
    expect(m("maxLegsInADuty")).toBe(3);
    expect(m("singleLegDutyShare")).toBeCloseTo(0.5, 5);
  });

  it("knows a double-deadhead trip needs no commute to base", () => {
    expect(m("doubleDeadheadTrips")).toBe(1);
    expect(m("baseCommutesNeeded")).toBe(0);
  });

  it("measures hours in a city, not just visits", () => {
    expect(m("layoverHoursInCities", { cities: ["CAN"] })).toBe(36);
    expect(m("layoversInCities", { cities: ["HNL", "SYD"] })).toBe(1);
  });

  it("credits the time a pilot can cut by deviating at either end", () => {
    // Front: 31h slack − 12h buffer = 19h; back: 21h − 10h rest = 11h → 30h shaved.
    expect(m("shortenableHours")).toBeCloseTo(30, 5);
    expect(m("tripsShortenableByADay")).toBe(1);
    // Rates use the trip's own credit and time away (40h over 160h scheduled, 130h after shortening).
    expect(m("effectiveCreditPerDayAway")).toBeCloseTo(40 / (130 / 24), 5);
    expect(m("creditPerDayAway")).toBeCloseTo(40 / (160 / 24), 5);
    // A pilot who wants more buffer gets less credit for it.
    expect(m("shortenableHours", { frontBufferHours: 30, backRestHours: 21 })).toBeCloseTo(1, 5);
  });

  it("values layovers by city and length together, and long layovers with no ceiling", () => {
    // 20h in a loved HNL, 36h in a hated CAN, 30h in neutral LAX.
    expect(m("layoverValue", { cityScores: { HNL: 1, CAN: -1 } })).toBe(20 - 36);
    expect(m("longLayoverHours")).toBe(6 + 12);
    expect(m("longLayoverHours", { minHours: 0 })).toBe(30 + 36 + 20);
  });

  it("counts every extra leg in a multi-leg duty", () => {
    expect(m("extraLegs")).toBe(2); // one three-leg duty
  });

  it("counts layovers inside a pilot's own length window", () => {
    expect(m("layoversInRange")).toBe(2); // 30h and 36h fall in the default 30–48
    expect(m("layoversInRange", { minHours: 34, maxHours: 40 })).toBe(1);
    expect(m("shortLayovers")).toBe(1);
  });
});

describe("door to door, for a commuter", () => {
  const home = { ...DEFAULT_HOME_PARAMS, homeAirports: ["SAN", "SNA", "LAX"] };

  it("joins a front-deadhead trip straight from home and leaves straight for home after the last flight", () => {
    const away = homeAwayForTrip(computeTripFacts(trip), "ANC", home)!;
    expect(away.start).toBe("deviate");
    expect(away.end).toBe("deviate");
    // Shorter than the base-to-base trip, even with travel and buffers added.
    expect(away.awayHours).toBeLessThan(trip.tafbHours);
  });

  it("never lets a pilot skip hotel standby by heading home early", () => {
    const standbyTrip: Trip = {
      ...trip,
      schedule: [
        trip.schedule[1],
        // Two standby days at CAN after the flying, then a deadhead home.
        { reportTimeLocal: "0700", startMinutes: 5580, legs: [leg("STHOTL", "CAN", "CAN", 5600, 6300, { isStandby: true, isDeadhead: false })], layover: { city: "CAN", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 12, startMinutes: 6300, endMinutes: 7020 } },
        { reportTimeLocal: "0700", startMinutes: 7020, legs: [leg("CX100", "CAN", "LAX", 7080, 7800)], layover: null },
      ],
    };
    const f = computeTripFacts(standbyTrip);
    // Free only once standby ends (6300), not when the last flight lands (3420).
    expect(f.back?.slackHours).toBeCloseTo((7080 - 6300) / 60, 5);
    const away = homeAwayForTrip(f, "ANC", home)!;
    expect(away.awayHours).toBeGreaterThan((6300 - 2160) / 60);
  });
});

describe("dates and standby", () => {
  it("counts the must-have dates a line works, from its own printed calendar", () => {
    // Off the first 14 days of a bid period that starts Sep 28: Sep 28 – Oct 11.
    const offFirstTwoWeeks: Line = { ...line, gridOffDays: Array.from({ length: 14 }, (_, i) => i) };
    const p = prepareMetrics({ ...pack, lines: [offFirstTwoWeeks] } as BidPack);
    const worked = (dates: string[]) => measure("requestedDatesWorked", offFirstTwoWeeks, p, { dates });
    expect(worked(["2026-10-10", "2026-10-11"])).toBe(0);
    expect(worked(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"])).toBe(2);
    // Dates outside the bid period can't be worked on this line.
    expect(worked(["2026-11-20"])).toBe(0);
    // Sep 28 2026 is a Monday: the 14 days off hold two Wednesdays and two Sundays.
    expect(measure("weekdaysOff", offFirstTwoWeeks, p, { weekdays: [3, 7] })).toBe(4);
    // No printed calendar, no answer.
    expect(measure("requestedDatesWorked", line, metrics, { dates: ["2026-10-10"] })).toBeNull();
  });

  it("tells standby on a trip from standby at base", () => {
    const sb = (city: string, start: number) => ({ reportTimeLocal: "0130", startMinutes: start, legs: [leg("STHOTL", city, city, start, start + 690, { isStandby: true, isDeadhead: false })], layover: null });
    const standbyLine: Line = {
      ...line,
      trips: [
        { ...trip, id: "t2", standbyDays: 2, schedule: [trip.schedule[1], sb("CAN", 5600), sb("CAN", 7000)] },
        { ...trip, id: "t3", standbyDays: 3, schedule: [sb("ANC", 0), sb("ANC", 1440), sb("ANC", 2880)] },
      ],
    };
    const p = prepareMetrics({ ...pack, lines: [standbyLine] } as BidPack);
    expect(measure("hotelStandbyDays", standbyLine, p)).toBe(5);
    expect(measure("tripStandbyDays", standbyLine, p)).toBe(2);
    expect(measure("baseStandbyDays", standbyLine, p)).toBe(3);
    // Standby valued by city: worthless in a hated CAN, 1.5 a day in a liked-enough ANC.
    expect(measure("standbyDaysByCity", standbyLine, p, { cityScores: { CAN: -1, ANC: 0.5 } })).toBe(4.5);
  });
});

describe("night work", () => {
  it("counts every minute in the small hours, not just a leg's two ends", () => {
    expect(deepNightOverlapMinutes(22 * 60, 7.5 * 60)).toBe(300); // 22:00 → 05:30 flies the whole 00:00–05:00
    expect(deepNightOverlapMinutes(3 * 60, 60)).toBe(60);
    expect(deepNightOverlapMinutes(15 * 60, 11.5 * 60)).toBe(150); // standby 15:00 → 02:30
    expect(deepNightOverlapMinutes(8 * 60, 8 * 60)).toBe(0);
    expect(deepNightOverlapMinutes(null, 600)).toBe(0);
  });

  it("counts a nightly shuttle as consecutive nights, even when each night is split across two duties", () => {
    // Report 01:05: out 02:05–04:33, sleep the day, back 22:28–23:59, out again 02:05 … — three nights straight.
    const fly = (fn: string, start: number, end: number) => ({ reportTimeLocal: "0105", startMinutes: start, legs: [leg(fn, "MEM", "ICT", start, end)], layover: null });
    const shuttle: Trip = { ...trip, id: "s", schedule: [fly("1559", 60, 208), fly("1305", 1283, 1374), fly("1559", 1500, 1648), fly("1305", 2723, 2814), fly("1559", 2940, 3088)] };
    const l: Line = { ...line, trips: [shuttle] };
    const p = prepareMetrics({ ...pack, lines: [l] } as BidPack);
    expect(measure("nightsWorked", l, p)).toBe(3);
    expect(measure("longestNightStreak", l, p)).toBe(3);
  });

  it("treats overnight standby as night work, and finds the longest run of nights", () => {
    const sb = (start: number) => ({ reportTimeLocal: "1500", startMinutes: start, legs: [leg("STHOTL", "OAK", "OAK", start, start + 690, { isStandby: true, isDeadhead: false, depTimeLocal: "1500", arrTimeLocal: "0230" })], layover: null });
    const day = (start: number) => ({ reportTimeLocal: "0900", startMinutes: start, legs: [leg("201", "OAK", "MEM", start, start + 240, { depTimeLocal: "1000", arrTimeLocal: "1400" })], layover: null });
    const nights: Trip = { ...trip, id: "n", schedule: [sb(0), sb(1440), day(2880), sb(4320), sb(5760), sb(7200)] };
    const l: Line = { ...line, trips: [nights] };
    const p = prepareMetrics({ ...pack, lines: [l] } as BidPack);
    expect(measure("nightsWorked", l, p)).toBe(5);
    expect(measure("longestNightStreak", l, p)).toBe(3);
    expect(measure("deepNightHours", l, p)).toBeCloseTo(5 * 2.5, 5);
    // Standby isn't flying: no red-eye legs here.
    expect(measure("redEyeLegs", l, p)).toBe(0);
  });
});

describe("release times", () => {
  it("treats a block-in after midnight as later than one the evening before", () => {
    const backAt = (arr: string, id: string): Trip => ({ ...trip, id, schedule: [{ reportTimeLocal: "1800", startMinutes: 0, legs: [leg("301", "ICN", "ANC", 0, 300, { arrTimeLocal: arr })], layover: null }] });
    const evening: Line = { ...line, id: "E", trips: [backAt("2200", "e")] };
    const night: Line = { ...line, id: "N", trips: [backAt("0519", "n")] };
    const p = prepareMetrics({ ...pack, lines: [evening, night] } as BidPack);
    expect(measure("latestBaseRelease", evening, p)).toBe(22 * 60);
    expect(measure("latestBaseRelease", night, p)).toBe(29 * 60 + 19);
  });
});
