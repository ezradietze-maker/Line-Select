import { describe, expect, it } from "vitest";
import { isCompanyFlight, jumpseatFlights } from "@/lib/flights/jumpseat";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";

function leg(fn: string, from: string, to: string, start: number, end: number, extra: Partial<TripLeg> = {}): TripLeg {
  return {
    flightNumber: fn, equipment: /^\d+$/.test(fn) ? "77" : "JET", isDeadhead: !/^\d+$/.test(fn), depAirport: from, arrAirport: to, depTimeLocal: "0000",
    depTimeGmt: "0000", arrTimeLocal: "0000", arrTimeGmt: "0000", blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "",
    arrTimeZulu: "", ...extra,
  };
}

const trip = (startDayIndex: number): Trip => ({
  id: "t1", pairingNumber: "5", days: 2, layoverCities: ["OAK"], layoverDetails: [], reportTime: "early", international: false, deadheadLegs: 1,
  creditHours: 10, landings: 1, tafbHours: 30, departures: 1, zuluAnchor: "", startDayIndex,
  schedule: [
    { reportTimeLocal: "0800", startMinutes: 0, legs: [leg("0031", "ANC", "OAK", 60, 360), leg("STHOTL", "OAK", "OAK", 400, 1000, { isStandby: true, isDeadhead: false })], layover: null },
    { reportTimeLocal: "0800", startMinutes: 1440, legs: [leg("GT9999", "OAK", "SFO", 1500, 1560, { equipment: "CAB" }), leg("AS0098", "SFO", "ANC", 1620, 1920)], layover: null },
  ],
});
const lines: Line[] = [
  { id: "a", lineNumber: "1", trips: [trip(2)], daysOff: 20, totalCreditHours: 10, totalTafbHours: 30, totalLandings: 1, totalDepartures: 1 },
  // The same run of the same pairing in another line counts once; a later run is its own flight.
  { id: "b", lineNumber: "2", trips: [trip(2), trip(9)], daysOff: 20, totalCreditHours: 20, totalTafbHours: 60, totalLandings: 2, totalDepartures: 2 },
];
const pack = { id: "p", month: "OCT26", base: "ANC", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines } as unknown as BidPack;

describe("FedEx flights from the bid pack, for the jumpseat", () => {
  it("knows a FedEx flight from an airline deadhead, a cab and standby", () => {
    const legs = trip(2).schedule.flatMap((d) => d.legs);
    expect(legs.map(isCompanyFlight)).toEqual([true, false, false, false]);
  });

  it("lists each FedEx departure once, on its real date and time", () => {
    const fx = jumpseatFlights(pack);
    expect(fx.map((f) => f.n)).toEqual(["FX 31", "FX 31"]);
    // Sep 30, 08:00 Anchorage (16:00Z) report, wheels up an hour later.
    expect(fx[0]).toMatchObject({ from: "ANC", to: "OAK", dep: Date.UTC(2026, 8, 30, 17), arr: Date.UTC(2026, 8, 30, 22), jumpseat: true });
    expect(fx[1].dep - fx[0].dep).toBe(7 * 24 * 3600_000);
  });
});
