import { describe, expect, it } from "vitest";
import { checkInShare } from "@/lib/logbook";
import type { LoggedMonth } from "@/types/logbook";

const month: LoggedMonth = {
  id: "MEM-MD11-CAP-NOV26",
  base: "MEM",
  aircraft: "MD11",
  seat: "CAP",
  month: "NOV26",
  outcome: "line",
  lineNumber: "1033",
  creditHours: 78.4,
  daysOff: 15,
  tafbHours: 210.6,
  rankedAt: 3,
  seniorityRank: 412,
  seniorityTotalPilots: 1200,
  loggedAt: "2026-11-02T00:00:00Z",
  sharedAt: "2026-11-02T00:00:01Z",
  checkIn: { feel: "better", at: "2026-12-01T00:00:00Z" },
};

describe("sharing how a month flew", () => {
  it("re-sends a shared month with its check-in and the brain that ranked it", () => {
    expect(checkInShare(month, { brainVersion: 24, notesUsed: false })).toMatchObject({
      month: "NOV26",
      lineNumber: "1033",
      totalCreditHours: 78,
      awardedChoice: 3,
      monthFeel: "better",
      brainVersion: 24,
      notesUsed: false,
    });
  });

  it("sends nothing for a month never shared, or not yet checked in", () => {
    expect(checkInShare({ ...month, sharedAt: undefined }, null)).toBeNull();
    expect(checkInShare({ ...month, checkIn: undefined }, null)).toBeNull();
  });
});
