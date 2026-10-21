import { describe, expect, it } from "vitest";
import { groupDepartures } from "@/lib/metrics/departures";
import type { Trip, TripLeg } from "@/types/bidpack";

/**
 * Made-up Memphis trips placed on real dates, shaped like real ones: a straight turn at base (two trips flown back to
 * back), a day and a half sitting in Memphis, and trips days apart. The pilot commutes in from the West Coast.
 */
const PACK = { bidPeriodStart: "2026-09-28", base: "MEM" };
const SAN = { homeAirports: ["SAN"] };

function leg(fn: string, from: string, to: string, start: number, end: number): TripLeg {
  const clock = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
  return {
    flightNumber: fn, equipment: "M1F", isDeadhead: !/^\d+$/.test(fn), depAirport: from, arrAirport: to,
    depTimeLocal: clock(start), depTimeGmt: clock(start), arrTimeLocal: clock(end), arrTimeGmt: clock(end),
    blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "",
  };
}

/** A one-duty trip reporting at `report` (local, at base) on bid-period day `day`; leg minutes count from the report. */
function trip(id: string, day: number | null, report: string, legs: TripLeg[], credit = 8): Trip {
  return {
    id, pairingNumber: id, days: 1, layoverCities: [], layoverDetails: [], reportTime: "early", international: false,
    deadheadLegs: legs.filter((l) => l.isDeadhead).length, creditHours: credit, landings: legs.filter((l) => !l.isDeadhead).length,
    tafbHours: (legs.at(-1)!.endMinutes + 30) / 60, departures: legs.filter((l) => !l.isDeadhead).length, startDayIndex: day, zuluAnchor: "",
    schedule: [{ reportTimeLocal: report, startMinutes: 0, legs, layover: null }],
  };
}

// Reports 06:00 on day 2, back in Memphis at 20:00.
const first = trip("111", 2, "0600", [leg("1423", "MEM", "SEA", 60, 300), leg("1424", "SEA", "MEM", 600, 840)]);
// Reports at 22:00 the same day: two hours after the first one lands.
const straightTurn = trip("58", 2, "2200", [leg("1411", "MEM", "IAH", 60, 200), leg("1412", "IAH", "MEM", 400, 540)]);
// Reports at 10:00 on day 4: 38 hours after the first one lands.
const dayAndAHalf = trip("26", 4, "1000", [leg("1411", "MEM", "IAH", 60, 200), leg("1412", "IAH", "MEM", 400, 540)]);
// Reports on day 9: days later.
const daysLater = trip("115", 9, "0600", [leg("1423", "MEM", "SEA", 60, 300), leg("1424", "SEA", "MEM", 600, 840)]);

describe("groupDepartures", () => {
  it("joins trips flown back to back at base into one departure", () => {
    const deps = groupDepartures([first, straightTurn, daysLater], PACK, SAN);
    expect(deps.map((d) => d.trips.map((t) => t.id))).toEqual([["111", "58"], ["115"]]);
    expect(deps[0].turnHours[0]).toBeCloseTo(2, 5);
    expect(deps[0].creditHours).toBe(16);
  });

  it("keeps a commuter in Memphis when going home wouldn't give him 24 hours there", () => {
    // 38 hours in Memphis, but the trip home and back (and his buffer before a report) leaves well under 24 at home.
    const deps = groupDepartures([first, dayAndAHalf], PACK, SAN);
    expect(deps).toHaveLength(1);
    expect(deps[0].turnHours[0]).toBeCloseTo(38, 5);
  });

  it("lets a pilot who lives at base go home for the same 38 hours", () => {
    expect(groupDepartures([first, dayAndAHalf], PACK, { homeAirports: [] })).toHaveLength(2);
    expect(groupDepartures([first, dayAndAHalf], PACK, { homeAirports: ["MEM"] })).toHaveLength(2);
  });

  it("splits departures with time at home between them, and says how much", () => {
    const deps = groupDepartures([first, daysLater], PACK, SAN);
    expect(deps).toHaveLength(2);
    expect(deps[0].homeHoursAfter).toBeGreaterThan(48);
    expect(deps[0].leaveHome).toBeLessThan(deps[0].backHome!);
  });

  it("takes the pilot's own number for how long at home is worth going home for", () => {
    expect(groupDepartures([first, daysLater], PACK, { ...SAN, minHomeHours: 200 })).toHaveLength(1);
  });

  it("ends a departure on a deadhead home when that's quicker than riding back to base", () => {
    const deviates = trip("59", 2, "0230", [leg("1411", "MEM", "IAH", 60, 200), leg("AA200", "IAH", "MEM", 900, 1000)]);
    const [dep] = groupDepartures([deviates], PACK, SAN);
    expect(dep.end).toBe("deviate");
  });

  it("puts trips in date order whatever order the line lists them", () => {
    const deps = groupDepartures([daysLater, straightTurn, first], PACK, SAN);
    expect(deps.map((d) => d.trips.map((t) => t.id))).toEqual([["111", "58"], ["115"]]);
  });

  it("counts the commutes to and from Memphis, and none for a pilot who lives there", () => {
    expect(groupDepartures([first, straightTurn, daysLater], PACK, SAN).map((d) => d.baseCommutes)).toEqual([2, 2]);
    expect(groupDepartures([first, daysLater], PACK, { homeAirports: [] }).map((d) => d.baseCommutes)).toEqual([0, 0]);
    // Deadheading home at the end of the trip saves the commute back.
    const deviates = trip("59", 2, "0230", [leg("1411", "MEM", "IAH", 60, 200), leg("AA200", "IAH", "MEM", 900, 1000)]);
    expect(groupDepartures([deviates], PACK, SAN)[0].baseCommutes).toBe(1);
  });

  it("puts a commuter in a Memphis hotel before an early show into a long duty", () => {
    // 06:00 show and a 14-hour duty: he comes in the evening before.
    const [dep] = groupDepartures([first], PACK, SAN);
    expect(dep.baseNights).toEqual([{ reason: "before", nights: 1, tripNumber: "111" }]);
    expect(dep.jumpseatIns).toBe(0);
  });

  it("jumpseats in the night before a short early duty instead of taking a hotel", () => {
    const short = trip("70", 3, "0200", [leg("1411", "MEM", "IAH", 60, 200), leg("1412", "IAH", "MEM", 230, 300)]);
    const [dep] = groupDepartures([short], PACK, SAN);
    expect(dep.jumpseatIns).toBe(1);
    expect(dep.baseNights.filter((b) => b.reason === "before")).toEqual([]);
  });

  it("counts the nights waiting in Memphis between trips of one departure, but not a straight turn", () => {
    const [sit] = groupDepartures([first, dayAndAHalf], PACK, SAN);
    expect(sit.baseNights.find((b) => b.reason === "between")).toEqual({ reason: "between", nights: 2, tripNumber: "26" });
    const [turn] = groupDepartures([first, straightTurn], PACK, SAN);
    expect(turn.baseNights.filter((b) => b.reason === "between")).toEqual([]);
  });

  it("keeps him in Memphis for the night after a late release", () => {
    // Back at base at 23:30: too late for the last flight home.
    const late = trip("80", 5, "1200", [leg("1411", "MEM", "IAH", 60, 200), leg("1412", "IAH", "MEM", 500, 690)]);
    const [dep] = groupDepartures([late], PACK, SAN);
    expect(dep.baseNights).toEqual([{ reason: "after", nights: 1, tripNumber: "80" }]);
  });

  it("counts no nights at base with a crash pad, or for a pilot who lives there", () => {
    expect(groupDepartures([first, dayAndAHalf], PACK, { ...SAN, hasCrashPad: true })[0].baseNights).toEqual([]);
    expect(groupDepartures([first, dayAndAHalf], PACK, { homeAirports: [] }).flatMap((d) => d.baseNights)).toEqual([]);
  });

  it("leaves a trip it can't place on a date standing alone", () => {
    const undated = trip("9", null, "0600", [leg("1423", "MEM", "SEA", 60, 300)]);
    const deps = groupDepartures([first, undated], PACK, SAN);
    expect(deps).toHaveLength(2);
    expect(deps.at(-1)!.trips[0].id).toBe("9");
    expect(deps.at(-1)!.leaveHome).toBeNull();
  });
});
