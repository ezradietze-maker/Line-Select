import { describe, expect, it } from "vitest";
import { describeFinding, flownLegs, hhmm, lineBlockLimits, parseFlownSoFar, readHours } from "@/lib/block-limits";
import type { Trip, TripLeg } from "@/types/bidpack";

const pack = { bidPeriodStart: "2026-09-28", base: "MEM" };

function leg(over: Partial<TripLeg> = {}): TripLeg {
  return {
    flightNumber: "1400",
    equipment: "76",
    isDeadhead: false,
    depAirport: "MEM",
    depTimeLocal: "0900",
    depTimeGmt: "1400",
    arrAirport: "IND",
    arrTimeLocal: "1100",
    arrTimeGmt: "1600",
    blockHours: 2,
    startMinutes: 60,
    endMinutes: 180,
    depTimeZulu: "",
    arrTimeZulu: "",
    ...over,
  };
}

/** A one-day trip on grid day `day`, reporting at 0800 MEM, with these legs. */
function dayTrip(day: number, legs: TripLeg[]): Trip {
  return {
    id: `t${day}`,
    pairingNumber: String(100 + day),
    days: 1,
    layoverCities: [],
    layoverDetails: [],
    reportTime: "early",
    international: false,
    deadheadLegs: 0,
    creditHours: 5,
    landings: legs.length,
    departures: legs.length,
    tafbHours: 10,
    zuluAnchor: "",
    startDayIndex: day,
    schedule: [{ reportTimeLocal: "0800", startMinutes: 0, legs, layover: null }],
  };
}

describe("the flying that counts", () => {
  it("is the legs the pilot operates: not deadheads, not hotel standby", () => {
    const legs = flownLegs(pack, { trips: [dayTrip(3, [leg(), leg({ isDeadhead: true, flightNumber: "DH" }), leg({ isStandby: true, flightNumber: "SBY" })])] });
    expect(legs.map((l) => l.flightNumber)).toEqual(["1400"]);
    // Grid day 3 from Sep 28 is Oct 1; report 0800 CDT plus an hour is 14:00Z.
    expect(new Date(legs[0].at).toISOString()).toBe("2026-10-01T14:00:00.000Z");
  });

  it("marks a duty over 8 block hours as flown with a relief pilot", () => {
    const legs = flownLegs(pack, { trips: [dayTrip(3, [leg({ blockHours: 5, depAirport: "MEM", arrAirport: "CDG" }), leg({ blockHours: 4, startMinutes: 400 })])] });
    expect(legs.every((l) => l.augmented)).toBe(true);
    expect(legs[0].international).toBe(true);
  });
});

describe("the federal limits against a line", () => {
  it("says nothing about a line that stays well clear", () => {
    expect(lineBlockLimits(pack, { trips: [dayTrip(3, [leg()])] }, { monthHours: 20 })).toEqual([]);
  });

  it("adds what the pilot flew before the period to the calendar month it starts in, and only that month", () => {
    // Two 4-hour days in September (Sep 29, 30) and one in October.
    const line = { trips: [dayTrip(1, [leg({ blockHours: 4 })]), dayTrip(2, [leg({ blockHours: 4 })]), dayTrip(5, [leg({ blockHours: 4 })])] };
    const over = lineBlockLimits(pack, line, { monthHours: 93 });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ kind: "month", level: "over", hours: 101, limit: 100, when: "September", before: 93 });
    expect(describeFinding(over[0])).toBe("Over the 100-hour limit in September: 101:00 block, with the 93:00 you'd flown before.");
    const close = lineBlockLimits(pack, line, { monthHours: 88 });
    expect(close[0]).toMatchObject({ kind: "month", level: "close", hours: 96 });
    expect(describeFinding(close[0])).toBe("Within 4:00 of the 100-hour limit in September: 96:00 block, with the 88:00 you'd flown before.");
  });

  it("finds 7 days in a row over 30 hours of domestic flying", () => {
    // 6.5 block hours a day for five days: 32:30 in 7 days.
    const line = { trips: [3, 4, 5, 6, 7].map((d) => dayTrip(d, [leg({ blockHours: 3.25 }), leg({ blockHours: 3.25, startMinutes: 300 })])) };
    const f = lineBlockLimits(pack, line).find((x) => x.kind === "week")!;
    expect(f).toMatchObject({ level: "over", hours: 32.5, limit: 30, when: "Oct 1–7" });
    expect(f.legs).toHaveLength(10);
  });

  it("names the day of a counted leg that falls on the 8th calendar day of the 7-day window", () => {
    // 7 hours a day Sep 29 – Oct 2 from 0900, then 3 hours at 0800 on Oct 6: inside the 168 hours from the first leg.
    const line = {
      trips: [
        ...[1, 2, 3, 4].map((d) => dayTrip(d, [leg({ blockHours: 3.5 }), leg({ blockHours: 3.5, startMinutes: 300 })])),
        dayTrip(8, [leg({ blockHours: 3, startMinutes: 0 })]),
      ],
    };
    const f = lineBlockLimits(pack, line).find((x) => x.kind === "week")!;
    expect(f).toMatchObject({ level: "over", hours: 31, when: "Sep 29–Oct 6" });
  });

  it("uses 32 hours for a week with two-pilot international flying", () => {
    const line = { trips: [3, 4, 5, 6, 7].map((d) => dayTrip(d, [leg({ blockHours: 3.25, arrAirport: "YYZ" }), leg({ blockHours: 3.25, startMinutes: 300 })])) };
    const f = lineBlockLimits(pack, line).find((x) => x.kind === "week")!;
    expect(f).toMatchObject({ level: "over", limit: 32, hours: 32.5 });
  });

  it("leaves a week or month with relief-pilot flying unchecked, rather than hold it to two-pilot limits", () => {
    const line = { trips: [3, 4, 5, 6].map((d) => dayTrip(d, [leg({ blockHours: 5, arrAirport: "CDG" }), leg({ blockHours: 4.5, startMinutes: 400 })])) };
    expect(lineBlockLimits(pack, line, { monthHours: 95 })).toEqual([]);
  });

  it("checks the year only with the pilot's own count, relief-pilot flying included", () => {
    const line = { trips: [dayTrip(3, [leg({ blockHours: 5, arrAirport: "CDG" }), leg({ blockHours: 4.5, startMinutes: 400 })])] };
    expect(lineBlockLimits(pack, line).some((f) => f.kind === "year")).toBe(false);
    expect(lineBlockLimits(pack, line, { yearHours: 995 })[0]).toMatchObject({ kind: "year", level: "over", hours: 1004.5, when: "2026" });
  });
});

describe("hours as a pilot types them", () => {
  it("reads 62:30, 62.5 and 62, and nothing else", () => {
    expect(readHours("62:30")).toBe(62.5);
    expect(readHours("62.5")).toBe(62.5);
    expect(readHours("62")).toBe(62);
    expect(readHours("")).toBeUndefined();
    expect(readHours("lots")).toBeUndefined();
    expect(readHours("62:75")).toBeUndefined();
    expect(hhmm(62.5)).toBe("62:30");
  });

  it("keeps only sensible stored values", () => {
    expect(parseFlownSoFar('{"monthHours":62.5,"yearHours":"x"}')).toEqual({ monthHours: 62.5 });
    expect(parseFlownSoFar("not json")).toEqual({});
  });
});
