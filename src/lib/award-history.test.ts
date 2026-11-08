import { describe, expect, it } from "vitest";
import { AWARD_BANDS, awardBandOf, MIN_SHARED_PILOTS, ownListEntry, seniorityPercentile, summaryForSeniority } from "@/lib/award-history";

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

describe("the slices of a seat's list", () => {
  it("runs from the most senior slice to the most junior, whatever the seat's size", () => {
    expect(awardBandOf({ rank: 1, totalPilots: 100 })).toBe(0);
    expect(awardBandOf({ rank: 100, totalPilots: 100 })).toBe(AWARD_BANDS - 1);
    expect(awardBandOf({ rank: 50, totalPilots: 400 })).toBe(awardBandOf({ rank: 13, totalPilots: 100 }));
  });

  it("reads a pilot's numbers from their own slice", () => {
    const data = { totalReports: 9, bands: [{ reports: 1, avgDaysOff: null, avgCreditHours: null, lineRate: null }, { reports: 8, avgDaysOff: 15, avgCreditHours: 70, lineRate: 0.75 }] };
    expect(summaryForSeniority(data, { rank: 30, totalPilots: 100 })).toEqual({ totalReports: 9, nearbyCount: 8, avgDaysOff: 15, avgCreditHours: 70, lineRate: 0.75 });
  });

  it("shows nothing when the server sent nothing", () => {
    expect(summaryForSeniority({ totalReports: 0, bands: [] }, { rank: 1, totalPilots: 10 })).toEqual({ totalReports: 0, nearbyCount: 0, avgDaysOff: null, avgCreditHours: null, lineRate: null });
  });

  it("holds to the size agreed with the owner", () => {
    expect(MIN_SHARED_PILOTS).toBe(5);
  });
});

describe("a pilot's own entry on the list", () => {
  const pack = { seniorityList: [{ bidNumber: 1, seniority: 5 }, { bidNumber: 2, seniority: 8 }] };

  it("is found only by an exact seniority number", () => {
    expect(ownListEntry(pack, 8)?.bidNumber).toBe(2);
    expect(ownListEntry(pack, 7)).toBeNull();
    expect(ownListEntry(pack, null)).toBeNull();
    expect(ownListEntry(null, 8)).toBeNull();
  });
});
