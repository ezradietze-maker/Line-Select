import { describe, expect, it } from "vitest";
import { backupsOf, type TravelAnswer } from "@/lib/flights/itineraries";
import { travelKey, travelNeedsForPack, tripStartUtc, type TravelNeed } from "@/lib/flights/needs";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { measure, prepareMetrics } from "@/lib/metrics/compute";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";

/**
 * A trip that opens with a deadhead ANC→LAX and closes with one HNL→ANC, so a
 * commuter from San Diego is asked both ways each end: commute through base,
 * or fly straight to (and home from) where the flying starts and stops.
 */
function leg(fn: string, from: string, to: string, start: number, end: number): TripLeg {
  return {
    flightNumber: fn, equipment: "77", isDeadhead: !/^\d+$/.test(fn), depAirport: from, arrAirport: to, depTimeLocal: "0000", depTimeGmt: "0000",
    arrTimeLocal: "0000", arrTimeGmt: "0000", blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "",
  };
}

const trip: Trip = {
  id: "t1", pairingNumber: "501", days: 4, layoverCities: ["LAX", "HNL"], layoverDetails: [], reportTime: "early", international: false,
  deadheadLegs: 2, creditHours: 20, landings: 2, tafbHours: 80, departures: 2, zuluAnchor: "2026-10-01T00:00:00.000Z", startDayIndex: 2,
  schedule: [
    { reportTimeLocal: "0800", startMinutes: 0, legs: [leg("AS100", "ANC", "LAX", 60, 360)], layover: { city: "LAX", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 30, startMinutes: 360, endMinutes: 2160 } },
    { reportTimeLocal: "0700", startMinutes: 2160, legs: [leg("101", "LAX", "HNL", 2220, 2580)], layover: { city: "HNL", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 24, startMinutes: 2580, endMinutes: 4020 } },
    { reportTimeLocal: "0700", startMinutes: 4020, legs: [leg("HA200", "HNL", "ANC", 4080, 4440)], layover: null },
  ],
};
// The same pairing again later in the month — a different run, with its own flights.
const rerun: Trip = { ...trip, startDayIndex: 16 };
const line: Line = { id: "L1", lineNumber: "1001", trips: [trip, rerun], daysOff: 20, totalCreditHours: 40, totalTafbHours: 160, totalLandings: 4, totalDepartures: 4 };
const pack = { id: "p", month: "OCT26", base: "ANC", aircraft: "B777", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as unknown as BidPack;
const params = { homeAirports: ["SAN"], commuteBufferHours: 10, frontBufferHours: 12, backRestHours: 10 };
const H = 3_600_000;

/** A made-up answer: getting there, `n` departures an hour apart ending at the latest that works; going home, landing `homeIn` hours after the window opens. */
function answerFor(need: TravelNeed, n: number, homeIn = 6): TravelAnswer {
  if (need.arriveBy !== undefined) {
    const last = need.arriveBy - 4 * H;
    const departures = Array.from({ length: n }, (_, i) => last - (n - 1 - i) * H);
    return { id: need.id, tripId: need.tripId, kind: need.kind, options: n, jumpseatWays: 0, departures, lastDeparture: n ? last : null, firstArrival: null, best: null, window: [need.departAfter, need.departBefore] };
  }
  return {
    id: need.id, tripId: need.tripId, kind: need.kind, options: n, jumpseatWays: 0, departures: [], lastDeparture: null, firstArrival: n ? need.departAfter + homeIn * H : null, best: null,
    window: [need.departAfter, need.departBefore],
  };
}

describe("a commuter's real flights, per trip", () => {
  const needs = travelNeedsForPack(pack, params);

  it("asks each run of a pairing both ways at each end", () => {
    expect(needs.map((n) => n.id).sort()).toEqual(
      ["t1@16:deviateHome", "t1@16:deviateOut", "t1@16:homeFromBase", "t1@16:toBase", "t1@2:deviateHome", "t1@2:deviateOut", "t1@2:homeFromBase", "t1@2:toBase"].sort()
    );
    expect(travelKey(rerun)).toBe("t1@16");
    const toBase = needs.find((n) => n.id === "t1@2:toBase")!;
    // Report on Sep 30 at 08:00 Anchorage time (16:00Z), at base ten hours ahead.
    expect(tripStartUtc(pack, trip)).toBe(Date.UTC(2026, 8, 30, 16));
    expect(toBase.arriveBy).toBe(Date.UTC(2026, 8, 30, 6));
  });

  it("counts backups within a day's travel of the last flight that works", () => {
    const need = needs.find((n) => n.id === "t1@2:toBase")!;
    expect(backupsOf(answerFor(need, 4))).toBe(3);
    // Twenty flights an hour apart: only the last twelve hours' worth are anybody's backup.
    expect(backupsOf(answerFor(need, 20))).toBe(12);
  });

  it("feeds the commute measures, and says unknown for lines whose trips weren't looked up", () => {
    const flights: FlightAnswers = Object.fromEntries(
      needs.map((n) => [n.id, answerFor(n, n.tripId === "t1@2" ? (n.kind === "toBase" ? 1 : 5) : 3, n.kind === "deviateHome" ? 30 : 6)])
    );
    const pm = prepareMetrics(pack);
    pm.ctx.flights = flights;
    // The better way to work counts: 4 backups straight to LAX on the first run, 2 on the second.
    expect(measure("fewestBackupFlights", line, pm)).toBe(2);
    expect(measure("tripsShortOnBackups", line, pm, { n: 3 })).toBe(1);
    expect(measure("tripsShortOnBackups", line, pm, { backupFlights: 2 })).toBe(0);
    // Done flying in Honolulu at minute 2580. Riding the deadhead to base (released 4440, +1h to the curb) and home 6h later
    // beats 30h after the rest in Honolulu: (4440 + 60 + 360 − 2580) / 60 = 38 hours.
    expect(measure("longestTripHome", line, pm)).toBeCloseTo(38, 5);

    const unknown = prepareMetrics(pack);
    unknown.ctx.flights = { "t1@2:toBase": flights["t1@2:toBase"] };
    expect(measure("fewestBackupFlights", line, unknown)).toBeNull();
    expect(measure("fewestBackupFlights", line, prepareMetrics(pack))).toBeNull();
  });

  it("puts real airline times into time away from home", () => {
    const flights: FlightAnswers = Object.fromEntries(needs.map((n) => [n.id, answerFor(n, 3)]));
    const real = prepareMetrics(pack);
    real.ctx.flights = flights;
    const estimated = measure("homeAwayHours", line, prepareMetrics(pack), params)!;
    const withFlights = measure("homeAwayHours", line, real, params)!;
    expect(withFlights).not.toBeCloseTo(estimated, 1);
    // A deviation no airline flight makes is off the table, not estimated.
    const noDeviation: FlightAnswers = { ...flights, "t1@2:deviateOut": answerFor(needs.find((n) => n.id === "t1@2:deviateOut")!, 0) };
    real.ctx.flights = noDeviation;
    expect(measure("tripsJoinedFromHome", line, real, params)).toBe(1);
  });
});
