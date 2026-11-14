import { DateTime } from "luxon";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VacationCalendar } from "@/components/strategies/VacationCalendar";
import { findVacationSlides } from "@/lib/vacation-slide";
import type { BidPack, Line, Trip } from "@/types/bidpack";

const leg = (start: number) => ({ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "0900", depTimeGmt: "1400", arrAirport: "IND", arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 2, startMinutes: start + 60, endMinutes: start + 600, depTimeZulu: "", arrTimeZulu: "" });

/** The same day trip on days 10, 11 and 12 of the month, kept as one run the way the parser keeps it. */
const run = {
  id: "t-run",
  pairingNumber: "7001",
  days: 3,
  layoverCities: [],
  layoverDetails: [],
  reportTime: "early",
  international: false,
  deadheadLegs: 0,
  creditHours: 18,
  landings: 3,
  tafbHours: 30,
  departures: 3,
  dutyPeriods: 3,
  schedule: [0, 1440, 2880].map((m) => ({ reportTimeLocal: "0800", startMinutes: m, legs: [leg(m)], layover: null })),
  runStarts: [0, 1, 2],
  zuluAnchor: "",
  startDayIndex: 10,
} as unknown as Trip;
const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => i < 10 || i > 12);
const line = { id: "l1", lineNumber: "1001", trips: [run], daysOff: off.length, totalCreditHours: 18, totalTafbHours: 30, totalLandings: 3, totalDepartures: 3, gridOffDays: off } as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as BidPack;

/** A one-day vacation on the run's middle day (Oct 9), 0130 to 0129. */
const from = DateTime.fromISO("2026-09-28T01:30", { zone: "America/Chicago" }).plus({ days: 11 });
const vacation = { from: from.toUTC().toISO()!, to: from.plus({ days: 1 }).minus({ minutes: 1 }).toUTC().toISO()!, days: 1 };

describe("VacationCalendar", () => {
  const row = findVacationSlides({ pack, order: ["1001"], vacation }).lines[0];
  const html = renderToStaticMarkup(createElement(VacationCalendar, { row, pack, value: 6, byModel: false }));

  it("CBA 2026 7.G.1: a vacation on one day of a run strikes that day, not the whole run", () => {
    expect(row.asAwarded.removed).toHaveLength(1);
    expect(html.match(/line-through/g)).toHaveLength(1);
    expect([...html.matchAll(/title="(Trip 7001[^"]*)"/g)].map((m) => m[1])).toEqual(["Trip 7001", "Trip 7001 comes off — vacation takes it", "Trip 7001"]);
    expect(html).toContain("takes trip 7001 on Oct 9 off");
  });
  it("tells a screen reader where the slider puts the vacation, and which suggestion is chosen", () => {
    expect(html).toMatch(/aria-valuetext="As awarded, Oct 9 to Oct 9"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>As awarded/);
  });
});
