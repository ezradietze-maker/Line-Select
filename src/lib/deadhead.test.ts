import { describe, expect, it } from "vitest";
import { backfillDeadheads, isDeadheadFlightNumber } from "@/lib/deadhead";
import type { Trip, TripLeg } from "@/types/bidpack";

function leg(flightNumber: string, isDeadhead: boolean, extra: Partial<TripLeg> = {}): TripLeg {
  return {
    flightNumber, equipment: "72", isDeadhead, depAirport: "IST", depTimeLocal: "2220", depTimeGmt: "1920", arrAirport: "CDG", arrTimeLocal: "0101",
    arrTimeGmt: "2301", blockHours: 3.68, startMinutes: 0, endMinutes: 221, depTimeZulu: "", arrTimeZulu: "", ...extra,
  };
}

describe("deadheads", () => {
  it("are rides on another carrier's flight number, never a bare FedEx number", () => {
    for (const fn of ["DL2939", "AA3959", "UA5780", "GT9999", "AF0123", "9E4321"]) expect(isDeadheadFlightNumber(fn)).toBe(true);
    for (const fn of ["6917", "2681", "0037", "STHOTL"]) expect(isDeadheadFlightNumber(fn)).toBe(false);
  });

  it("corrects a pack saved when the meal column's \"DH\" (dinner, hot) was read as a deadhead", () => {
    const trip = {
      id: "t", deadheadLegs: 2,
      schedule: [
        { reportTimeLocal: "2000", startMinutes: 0, layover: null, legs: [leg("6917", true), leg("DL1624", true), leg("STHOTL", false, { isStandby: true })] },
      ],
    } as unknown as Trip;
    const fixed = backfillDeadheads(trip);
    expect(fixed.schedule[0].legs.map((l) => l.isDeadhead)).toEqual([false, true, false]);
    expect(fixed.deadheadLegs).toBe(1);
  });

  it("leaves a correctly read trip untouched", () => {
    const trip = { id: "t", deadheadLegs: 1, schedule: [{ reportTimeLocal: "2000", startMinutes: 0, layover: null, legs: [leg("6917", false), leg("DL1624", true)] }] } as unknown as Trip;
    expect(backfillDeadheads(trip)).toBe(trip);
  });
});
