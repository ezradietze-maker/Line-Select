import { describe, expect, it } from "vitest";
import { travelRequests } from "@/lib/flights/client";
import { jumpseatFlights } from "@/lib/flights/jumpseat";
import type { TravelNeed } from "@/lib/flights/needs";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";

const H = 3_600_000;

function leg(fn: string, from: string, to: string, start: number, end: number): TripLeg {
  return {
    flightNumber: fn, equipment: "76", isDeadhead: false, depAirport: from, arrAirport: to, depTimeLocal: "0000", depTimeGmt: "0000",
    arrTimeLocal: "0000", arrTimeGmt: "0000", blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "",
  };
}

// A big hub's month: 190 FedEx flights a day out of and back into Memphis, every day of a 28-day month — more than
// the 4,000 one request carries.
const trips: Trip[] = Array.from({ length: 28 }, (_, day) => ({
  id: `d${day}`, pairingNumber: `${day}`, days: 1, layoverCities: [], layoverDetails: [], reportTime: "early", international: false,
  deadheadLegs: 0, creditHours: 6, landings: 190, tafbHours: 24, departures: 190, zuluAnchor: "", startDayIndex: day,
  schedule: [{ reportTimeLocal: "0000", startMinutes: 0, legs: Array.from({ length: 190 }, (_, i) => leg(`${1000 + i}`, i % 2 ? "IND" : "MEM", i % 2 ? "MEM" : "IND", i * 7, i * 7 + 90)), layover: null }],
}));
const line: Line = { id: "L1", lineNumber: "1001", trips, daysOff: 0, totalCreditHours: 0, totalTafbHours: 0, totalLandings: 0, totalDepartures: 0 };
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as unknown as BidPack;

describe("the requests a lookup sends", () => {
  const all = jumpseatFlights(pack);
  const monthStart = all[0].dep;
  // Pack order isn't date order: questions from the month's end come first, its start after.
  const needs: TravelNeed[] = Array.from({ length: 1200 }, (_, i) => {
    const day = 27 - (i % 28);
    const departAfter = monthStart + day * 24 * H + (i % 5) * H;
    return { id: `n${i}`, tripId: `t${i}`, kind: "toBase", from: ["DEN"], to: ["MEM"], departAfter, departBefore: departAfter + 12 * H, arriveBy: departAfter + 12 * H };
  });

  it("sends every FedEx flight inside each question's window, the month's last week too", () => {
    expect(all.length).toBeGreaterThan(4000);
    const requests = travelRequests(pack, needs);
    expect(requests.flatMap((r) => r.needs.map((n) => n.id)).sort()).toEqual(needs.map((n) => n.id).sort());
    for (const r of requests) {
      expect(r.needs.length).toBeLessThanOrEqual(500);
      expect(r.jumpseats.length).toBeLessThanOrEqual(4000);
      const key = (f: { from: string; to: string; dep: number }) => `${f.from}|${f.to}|${f.dep}`;
      const sent = new Set(r.jumpseats.map(key));
      for (const n of r.needs) for (const f of all) if (f.dep >= n.departAfter && f.dep <= n.arriveBy!) expect(sent.has(key(f))).toBe(true);
    }
  });

  it("sends none when jumpseats don't count", () => {
    expect(travelRequests(pack, needs, false).every((r) => r.jumpseats.length === 0)).toBe(true);
  });
});
