import { describe, expect, it } from "vitest";
import { seniorityPercentile, summarizeAwardHistory } from "@/lib/award-history";
import type { AwardHistoryRecord } from "@/types/award-history";

function makeRecord(overrides: Partial<AwardHistoryRecord> = {}): AwardHistoryRecord {
  return {
    id: "r1",
    base: "MEM",
    aircraft: "B777",
    seat: "CAP",
    month: "SEP26",
    seniorityRank: 50,
    seniorityTotalPilots: 100,
    outcome: "line",
    lineNumber: "9001",
    daysOff: 15,
    totalCreditHours: 60,
    totalTafbHours: 70,
    submittedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("seniorityPercentile", () => {
  it("gives the most senior pilot a percentile of 1", () => {
    expect(seniorityPercentile({ rank: 1, totalPilots: 100 })).toBe(1);
  });

  it("gives the least senior pilot a percentile of 0", () => {
    expect(seniorityPercentile({ rank: 100, totalPilots: 100 })).toBe(0);
  });

  it("gives the middle pilot a percentile around 0.5", () => {
    expect(seniorityPercentile({ rank: 50, totalPilots: 99 })).toBeCloseTo(0.5, 5);
  });

  it("never divides by zero for a one-pilot seat", () => {
    expect(seniorityPercentile({ rank: 1, totalPilots: 1 })).toBe(1);
  });
});

describe("summarizeAwardHistory", () => {
  it("returns nulls when there are no records at all", () => {
    const summary = summarizeAwardHistory([], { rank: 50, totalPilots: 100 });
    expect(summary.totalReports).toBe(0);
    expect(summary.nearbyCount).toBe(0);
    expect(summary.avgDaysOff).toBeNull();
    expect(summary.avgCreditHours).toBeNull();
    expect(summary.lineRate).toBeNull();
  });

  it("excludes reports far outside the nearby-seniority window", () => {
    const records = [
      makeRecord({ id: "near", seniorityRank: 48, seniorityTotalPilots: 100 }),
      makeRecord({ id: "far", seniorityRank: 5, seniorityTotalPilots: 100 }),
    ];
    const summary = summarizeAwardHistory(records, { rank: 50, totalPilots: 100 });
    expect(summary.nearbyCount).toBe(1);
  });

  it("withholds averages below the minimum sample size, even with some nearby data", () => {
    const records = [
      makeRecord({ id: "a", seniorityRank: 49 }),
      makeRecord({ id: "b", seniorityRank: 51 }),
    ];
    const summary = summarizeAwardHistory(records, { rank: 50, totalPilots: 100 });
    expect(summary.nearbyCount).toBe(2);
    expect(summary.avgDaysOff).toBeNull();
    expect(summary.avgCreditHours).toBeNull();
  });

  it("computes real averages once the sample reaches the minimum size", () => {
    const records = [
      makeRecord({ id: "a", seniorityRank: 48, daysOff: 10, totalCreditHours: 50 }),
      makeRecord({ id: "b", seniorityRank: 49, daysOff: 20, totalCreditHours: 70 }),
      makeRecord({ id: "c", seniorityRank: 51, daysOff: 15, totalCreditHours: 60 }),
    ];
    const summary = summarizeAwardHistory(records, { rank: 50, totalPilots: 100 });
    expect(summary.avgDaysOff).toBeCloseTo(15, 5);
    expect(summary.avgCreditHours).toBeCloseTo(60, 5);
  });

  it("excludes non-line outcomes from the days-off/credit averages but still counts them toward nearbyCount and lineRate", () => {
    const records = [
      makeRecord({ id: "a", seniorityRank: 49, outcome: "line", daysOff: 10, totalCreditHours: 50 }),
      makeRecord({ id: "b", seniorityRank: 50, outcome: "line", daysOff: 20, totalCreditHours: 70 }),
      makeRecord({ id: "c", seniorityRank: 51, outcome: "line", daysOff: 15, totalCreditHours: 60 }),
      makeRecord({
        id: "d",
        seniorityRank: 50,
        outcome: "reserve",
        lineNumber: null,
        daysOff: null,
        totalCreditHours: null,
        totalTafbHours: null,
      }),
    ];
    const summary = summarizeAwardHistory(records, { rank: 50, totalPilots: 100 });
    expect(summary.nearbyCount).toBe(4);
    expect(summary.avgDaysOff).toBeCloseTo(15, 5);
    expect(summary.lineRate).toBeCloseTo(0.75, 5);
  });
});
