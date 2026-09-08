import { describe, expect, it } from "vitest";
import { buildLineCalendar } from "./ics-export";
import type { Line, Trip } from "@/types/bidpack";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    pairingNumber: "27",
    days: 3,
    layoverCities: ["NRT"],
    layoverDetails: [],
    reportTime: "midday" as Trip["reportTime"],
    international: true,
    deadheadLegs: 0,
    creditHours: 18.5,
    landings: 4,
    tafbHours: 72,
    departures: 1,
    schedule: [{ reportTimeLocal: "0930", startMinutes: 570, legs: [], layover: null }],
    zuluAnchor: "2026-01-01T09:30:00Z",
    startDayIndex: 2,
    ...overrides,
  };
}

function makeLine(trips: Trip[]): Line {
  return {
    id: "line-1",
    lineNumber: "9001",
    trips,
    daysOff: 20,
    totalCreditHours: trips.reduce((s, t) => s + t.creditHours, 0),
    totalTafbHours: trips.reduce((s, t) => s + t.tafbHours, 0),
    totalLandings: trips.reduce((s, t) => s + t.landings, 0),
    estimated: false,
  } as Line;
}

describe("buildLineCalendar", () => {
  it("fails honestly when bidPeriodStart is null, even with a real startDayIndex", () => {
    const line = makeLine([makeTrip()]);
    const result = buildLineCalendar(line, null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("fails honestly when any trip lacks a real startDayIndex", () => {
    const line = makeLine([makeTrip({ startDayIndex: null })]);
    const result = buildLineCalendar(line, "2026-03-01");
    expect(result.ok).toBe(false);
  });

  it("produces a valid VCALENDAR with one VEVENT per trip when placement is real", () => {
    const line = makeLine([makeTrip({ startDayIndex: 0 }), makeTrip({ id: "t2", startDayIndex: 5, pairingNumber: "42" })]);
    const result = buildLineCalendar(line, "2026-03-01");
    expect(result.ok).toBe(true);
    expect(result.content).toContain("BEGIN:VCALENDAR");
    expect(result.content).toContain("END:VCALENDAR");
    expect(result.content?.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(result.content).toContain("Pairing 27");
    expect(result.content).toContain("Pairing 42");
  });

  it("computes real calendar dates from bidPeriodStart plus startDayIndex", () => {
    const line = makeLine([makeTrip({ startDayIndex: 4, days: 2 })]);
    const result = buildLineCalendar(line, "2026-03-01");
    // day 0 = Mar 1, so day 4 = Mar 5; a 2-day trip ends Mar 7 (exclusive end, RFC 5545 all-day convention)
    expect(result.content).toContain("DTSTART;VALUE=DATE:20260305");
    expect(result.content).toContain("DTEND;VALUE=DATE:20260307");
  });

  it("names the real local report time in the description without claiming it as the event's clock time", () => {
    const line = makeLine([makeTrip({ startDayIndex: 0, schedule: [{ reportTimeLocal: "1430", startMinutes: 870, legs: [], layover: null }] })]);
    const result = buildLineCalendar(line, "2026-03-01");
    expect(result.content).toContain("Reports 14:30 local");
    expect(result.content).not.toMatch(/DTSTART:\d{8}T1430/);
  });

  it("omits a report-time line entirely when the trip has no verified schedule", () => {
    const line = makeLine([makeTrip({ startDayIndex: 0, schedule: [] })]);
    const result = buildLineCalendar(line, "2026-03-01");
    expect(result.content).not.toContain("Reports");
  });
});
