import { describe, expect, it } from "vitest";
import { buildMonthGrid, monthGridSummary } from "@/lib/month-grid";
import type { Line, Trip } from "@/types/bidpack";

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    pairingNumber: null,
    days: 3,
    layoverCities: [],
    layoverDetails: [],
    reportTime: "early",
    international: false,
    deadheadLegs: 0,
    creditHours: 12,
    landings: 2,
    tafbHours: 50,
    departures: 1,
    zuluAnchor: "2026-09-28T00:00:00.000Z",
    startDayIndex: 2,
    schedule: [],
    ...over,
  };
}

function line(trips: Trip[], daysOff = 20): Line {
  return { id: "l1", lineNumber: "1001", trips, daysOff, totalCreditHours: 80, totalTafbHours: 100, totalLandings: 4, totalDepartures: 2 };
}

describe("buildMonthGrid", () => {
  it("lays a 28-day period out as 28 cells with real dates and weekday headers rotated to the period's first day", () => {
    const grid = buildMonthGrid(line([trip()]), "2026-09-28", 28);
    expect(grid.cells).toHaveLength(28);
    expect(grid.placementIsReal).toBe(true);
    expect(grid.weekdayHeaders).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(grid.cells[0].label).toBe("28");
    expect(grid.cells[3].label).toBe("1");
  });

  it("marks off days and trip days, with the trip start flagged", () => {
    const grid = buildMonthGrid(line([trip()]), "2026-09-28", 28);
    expect(grid.cells[0].kind).toBe("off");
    expect(grid.cells[1].kind).toBe("off");
    expect(grid.cells[2].kind).toBe("estimated");
    expect(grid.cells[2].isTripStart).toBe(true);
    expect(grid.cells[3].isTripStart).toBe(false);
    expect(grid.cells.filter((c) => c.kind === "off")).toHaveLength(25);
  });

  it("starts the weekday headers on whatever weekday the period starts", () => {
    const grid = buildMonthGrid(line([trip()]), "2026-09-30", 28);
    expect(grid.weekdayHeaders?.[0]).toBe("Wed");
  });

  it("falls back to day numbers and no weekday headers when real dates aren't known", () => {
    const grid = buildMonthGrid(line([trip({ startDayIndex: null })]), null, 28);
    expect(grid.placementIsReal).toBe(false);
    expect(grid.weekdayHeaders).toBeNull();
    expect(grid.cells[0].label).toBe("1");
  });

  it("summarizes the month in one sentence", () => {
    const grid = buildMonthGrid(line([trip()]), "2026-09-28", 28);
    expect(monthGridSummary(grid)).toBe("1 trip, 25 days off.");
  });
});
