import { describe, expect, it } from "vitest";
import { tripSpans } from "@/lib/phase-in";
import { dayTripsOf, runDaysOf, tripReleaseHours } from "@/lib/trip-anchor";
import type { Trip } from "@/types/bidpack";

const DAY = 1440;
const leg = (from: string, to: string, start: number, end: number) => ({ depAirport: from, arrAirport: to, startMinutes: start, endMinutes: end, isDeadhead: false }) as unknown as Trip["schedule"][number]["legs"][number];
const layover = (city: string, start: number, end: number) => ({ city, startMinutes: start, endMinutes: end, hours: (end - start) / 60 }) as unknown as NonNullable<Trip["schedule"][number]["layover"]>;

/** One day of the pairing: out to BWI, a hotel, back the same day — two duties, 9.5 hours report to release. */
const day = (shift: number): Trip["schedule"] => [
  { startMinutes: shift, reportTimeLocal: "0400", legs: [leg("MEM", "BWI", shift + 60, shift + 180)], layover: layover("BWI", shift + 195, shift + 375) } as unknown as Trip["schedule"][number],
  { startMinutes: shift + 375, reportTimeLocal: "1015", legs: [leg("BWI", "MEM", shift + 435, shift + 555)], layover: null } as unknown as Trip["schedule"][number],
];

const run = (days: number, marked: boolean): Trip =>
  ({
    id: "t31",
    pairingNumber: "31",
    startDayIndex: 14,
    days,
    tafbHours: 9.5 * days,
    creditHours: 8 * days,
    layoverCities: [],
    layoverDetails: [],
    zuluAnchor: "2026-10-12T09:00:00.000Z",
    schedule: Array.from({ length: days }, (_, i) => day(i * DAY)).flat(),
    ...(marked ? { runStarts: Array.from({ length: days }, (_, i) => i * 2) } : {}),
  }) as unknown as Trip;

describe("a run of the same day trip on consecutive days", () => {
  it.each([true, false])("knows its days, two duties each, with the parser's marks (%s) or by its shape", (marked) => {
    const days = runDaysOf(run(4, marked))!;
    expect(days.map((d) => [d.first, d.last, d.startMinutes / DAY])).toEqual([
      [0, 1, 0],
      [2, 3, 1],
      [4, 5, 2],
      [6, 7, 3],
    ]);
    // Released 9.5 hours after its last day reports, not after the first day's run of the summed hours.
    expect(tripReleaseHours(run(4, marked))).toBeCloseTo(3 * 24 + 9.5);
    expect(tripReleaseHours(run(2, marked))).toBeCloseTo(24 + 9.5);
  });

  it("is split into its days, each whole and on its own date", () => {
    const pieces = dayTripsOf(run(3, true));
    expect(pieces.map((p) => p.startDayIndex)).toEqual([14, 15, 16]);
    expect(pieces.every((p) => p.schedule.length === 2 && p.schedule[0].startMinutes === 0 && p.tafbHours === 9.5 && p.creditHours === 8)).toBe(true);
    expect(pieces[1].schedule[1].legs[0].arrAirport).toBe("MEM");
    expect(pieces.every((p) => p.runStarts === undefined)).toBe(true);
  });

  it("gives each day's duties their own ends, none running into the next", () => {
    const spans = tripSpans(run(3, true), 0);
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    expect(spans[1].end).toBe(9.5 * 3_600_000);
  });

  it("leaves an ordinary trip alone: every duty but the last has a layover", () => {
    const trip = { ...run(1, false), tafbHours: 9.5 } as Trip;
    expect(runDaysOf(trip)).toBeNull();
    expect(tripReleaseHours(trip)).toBe(9.5);
    expect(dayTripsOf(trip)).toEqual([trip]);
  });
});
