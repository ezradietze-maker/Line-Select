import { describe, expect, it } from "vitest";
import { computeFilterOptions } from "@/lib/line-filter-options";
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
    startDayIndex: null,
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

describe("computeFilterOptions — minDaysOffSteps / minCreditHoursSteps", () => {
  it("is empty when every line has the same value — the exact bug report: a fixed 30+ chip that every real line already clears", () => {
    const lines = [
      makeLine({ id: "l1", totalCreditHours: 60 }),
      makeLine({ id: "l2", totalCreditHours: 60 }),
      makeLine({ id: "l3", totalCreditHours: 60 }),
    ];
    expect(computeFilterOptions(lines).minCreditHoursSteps).toEqual([]);
  });

  it("never includes the pack's own minimum as a threshold — that would exclude nothing", () => {
    const lines = [makeLine({ id: "l1", daysOff: 10 }), makeLine({ id: "l2", daysOff: 20 })];
    const steps = computeFilterOptions(lines).minDaysOffSteps;
    expect(steps).not.toContain(10);
    expect(steps).toContain(20);
  });

  it("caps at 3 real thresholds even with many distinct values, always including the true max", () => {
    const lines = [10, 20, 30, 40, 50, 60, 70].map((v, i) => makeLine({ id: `l${i}`, totalCreditHours: v }));
    const steps = computeFilterOptions(lines).minCreditHoursSteps;
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(steps).toContain(70);
    expect(steps).not.toContain(10);
  });
});

describe("computeFilterOptions — maxTripDaysSteps", () => {
  it("is empty when every trip runs the same length", () => {
    const lines = [makeLine({}, [makeTrip({ days: 3 }), makeTrip({ id: "t2", days: 3 })])];
    expect(computeFilterOptions(lines).maxTripDaysSteps).toEqual([]);
  });

  it("never includes the pack's own longest trip as a cap — that would exclude nothing", () => {
    const lines = [makeLine({}, [makeTrip({ days: 2 }), makeTrip({ id: "t2", days: 5 })])];
    const steps = computeFilterOptions(lines).maxTripDaysSteps;
    expect(steps).not.toContain(5);
    expect(steps).toContain(2);
  });
});

describe("computeFilterOptions — tripCountOptions", () => {
  it("is empty when every line has the same trip count", () => {
    const lines = [makeLine({ id: "l1" }, [makeTrip()]), makeLine({ id: "l2" }, [makeTrip()])];
    expect(computeFilterOptions(lines).tripCountOptions).toEqual([]);
  });

  it("lists the real distinct counts present, collapsing anything at or above 3", () => {
    const oneTrip = makeLine({ id: "l1" }, [makeTrip()]);
    const threeTrips = makeLine({ id: "l2" }, [makeTrip(), makeTrip({ id: "t2" }), makeTrip({ id: "t3" })]);
    const options = computeFilterOptions([oneTrip, threeTrips]).tripCountOptions;
    expect(options).toEqual([1, "3plus"]);
  });
});

describe("computeFilterOptions — availableReportTimes", () => {
  it("is empty when every trip reports at the same time — nothing to choose between", () => {
    const lines = [makeLine({}, [makeTrip({ reportTime: "afternoon" }), makeTrip({ id: "t2", reportTime: "afternoon" })])];
    expect(computeFilterOptions(lines).availableReportTimes).toEqual([]);
  });

  it("lists only the times that actually occur, in a fixed order", () => {
    const lines = [makeLine({}, [makeTrip({ reportTime: "evening" }), makeTrip({ id: "t2", reportTime: "early" })])];
    expect(computeFilterOptions(lines).availableReportTimes).toEqual(["early", "evening"]);
  });
});

describe("computeFilterOptions — boolean toggles", () => {
  it("hides the deadhead toggle when no trip in the pack has one", () => {
    const lines = [makeLine({}, [makeTrip({ deadheadLegs: 0 })])];
    expect(computeFilterOptions(lines).showDeadheadToggle).toBe(false);
  });

  it("shows the deadhead toggle when at least one trip has a deadhead leg", () => {
    const lines = [makeLine({}, [makeTrip({ deadheadLegs: 1 })])];
    expect(computeFilterOptions(lines).showDeadheadToggle).toBe(true);
  });

  it("hides the verified-only toggle when no line is estimated", () => {
    const lines = [makeLine({ estimated: false })];
    expect(computeFilterOptions(lines).showVerifiedToggle).toBe(false);
  });

  it("shows the verified-only toggle when at least one line is estimated", () => {
    const lines = [makeLine({ estimated: true }), makeLine({ id: "l2", estimated: false })];
    expect(computeFilterOptions(lines).showVerifiedToggle).toBe(true);
  });
});

describe("computeFilterOptions — routing", () => {
  it("hides routing options when every trip is domestic", () => {
    const lines = [makeLine({}, [makeTrip({ international: false })])];
    expect(computeFilterOptions(lines).showRoutingOptions).toBe(false);
  });

  it("hides routing options when every trip is international", () => {
    const lines = [makeLine({}, [makeTrip({ international: true })])];
    expect(computeFilterOptions(lines).showRoutingOptions).toBe(false);
  });

  it("shows routing options only with a genuine mix", () => {
    const lines = [makeLine({}, [makeTrip({ international: true }), makeTrip({ id: "t2", international: false })])];
    expect(computeFilterOptions(lines).showRoutingOptions).toBe(true);
  });
});
