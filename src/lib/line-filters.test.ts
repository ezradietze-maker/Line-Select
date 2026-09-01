import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  collectLayoverCities,
  filtersActive,
  lineMatchesFilters,
  type LineFilters,
} from "@/lib/line-filters";
import type { Line, Trip } from "@/types/bidpack";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    pairingNumber: "1",
    days: 2,
    layoverCities: ["LAX"],
    layoverDetails: [{ city: "LAX", hotelName: null }],
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: 10,
    landings: 2,
    tafbHours: 20,
    departures: 1,
    schedule: [],
    zuluAnchor: "",
    ...overrides,
  };
}

function makeLine(overrides: Partial<Line> = {}, trips: Trip[] = [makeTrip()]): Line {
  return {
    id: "l1",
    lineNumber: "9001",
    trips,
    daysOff: 15,
    totalCreditHours: 60,
    totalTafbHours: 70,
    totalLandings: 4,
    totalDepartures: 2,
    ...overrides,
  };
}

describe("filtersActive / activeFilterCount", () => {
  it("reports inactive for the empty filter set", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("counts each independently-set dimension once", () => {
    const filters: LineFilters = {
      minDaysOff: 5,
      reportTimes: new Set(["early"]),
      cities: new Set(["ANC"]),
      noDeadheadsOnly: true,
      international: "international",
    };
    expect(filtersActive(filters)).toBe(true);
    expect(activeFilterCount(filters)).toBe(5);
  });
});

describe("lineMatchesFilters — minDaysOff", () => {
  it("excludes a line with fewer days off than the threshold", () => {
    const line = makeLine({ daysOff: 12 });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, minDaysOff: 15 })).toBe(false);
  });

  it("includes a line with exactly the threshold", () => {
    const line = makeLine({ daysOff: 15 });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, minDaysOff: 15 })).toBe(true);
  });
});

describe("lineMatchesFilters — report time", () => {
  it("matches when at least one trip reports at a selected time, not all", () => {
    const line = makeLine(
      {},
      [makeTrip({ reportTime: "early" }), makeTrip({ id: "t2", reportTime: "evening" })]
    );
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, reportTimes: new Set(["early"]) })).toBe(true);
  });

  it("excludes a line whose trips report at none of the selected times", () => {
    const line = makeLine({}, [makeTrip({ reportTime: "afternoon" })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, reportTimes: new Set(["early"]) })).toBe(false);
  });
});

describe("lineMatchesFilters — layover city", () => {
  it("matches a line touching any selected city", () => {
    const line = makeLine({}, [makeTrip({ layoverCities: ["ANC", "SEA"] })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, cities: new Set(["SEA"]) })).toBe(true);
  });

  it("excludes a line that never touches a selected city", () => {
    const line = makeLine({}, [makeTrip({ layoverCities: ["LAX"] })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, cities: new Set(["SEA"]) })).toBe(false);
  });
});

describe("lineMatchesFilters — no deadheads", () => {
  it("excludes a line with any deadhead leg on any trip", () => {
    const line = makeLine({}, [makeTrip({ deadheadLegs: 0 }), makeTrip({ id: "t2", deadheadLegs: 1 })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, noDeadheadsOnly: true })).toBe(false);
  });

  it("includes a line with zero deadhead legs across every trip", () => {
    const line = makeLine({}, [makeTrip({ deadheadLegs: 0 }), makeTrip({ id: "t2", deadheadLegs: 0 })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, noDeadheadsOnly: true })).toBe(true);
  });
});

describe("lineMatchesFilters — international routing", () => {
  it("international-only excludes an all-domestic line", () => {
    const line = makeLine({}, [makeTrip({ international: false })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, international: "international" })).toBe(false);
  });

  it("domestic-only excludes a line with any international trip", () => {
    const line = makeLine({}, [makeTrip({ international: false }), makeTrip({ id: "t2", international: true })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, international: "domestic" })).toBe(false);
  });

  it("any (default) never excludes on routing", () => {
    const line = makeLine({}, [makeTrip({ international: true })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, international: "any" })).toBe(true);
  });
});

describe("collectLayoverCities", () => {
  it("returns every distinct city across all lines and trips, sorted", () => {
    const lines = [
      makeLine({ id: "l1" }, [makeTrip({ layoverCities: ["SEA", "ANC"] })]),
      makeLine({ id: "l2" }, [makeTrip({ layoverCities: ["LAX"] }), makeTrip({ id: "t2", layoverCities: ["ANC"] })]),
    ];
    expect(collectLayoverCities(lines)).toEqual(["ANC", "LAX", "SEA"]);
  });

  it("returns an empty array for lines with no layovers", () => {
    const lines = [makeLine({ id: "l1" }, [makeTrip({ layoverCities: [] })])];
    expect(collectLayoverCities(lines)).toEqual([]);
  });
});
