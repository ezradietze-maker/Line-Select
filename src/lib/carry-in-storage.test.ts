import { describe, expect, it } from "vitest";
import { carryInFromLogbook } from "@/lib/carry-in-storage";
import type { LoggedMonth } from "@/types/logbook";

const logged = (month: string, report: string, release: string): LoggedMonth => ({
  id: month,
  base: "MEM",
  aircraft: "B767",
  seat: "CAP",
  month,
  outcome: "line",
  loggedAt: "2026-10-01T00:00:00Z",
  carryOut: [{ label: "Trip 99", report, release, international: true, creditHours: 22, duties: [] }],
});

describe("carryInFromLogbook", () => {
  const pack = { month: "DEC26", bidPeriodStart: "2026-11-30" };
  it("offers a logged trip that's flying when the new month starts", () => {
    const [trip] = carryInFromLogbook([logged("NOV26", "2026-11-28T14:00:00Z", "2026-12-01T02:00:00Z")], pack);
    expect(trip).toMatchObject({ kind: "trip", label: "Trip 99", international: true });
  });
  it("leaves out a trip from another month, and this month's own entry", () => {
    expect(carryInFromLogbook([logged("OCT26", "2026-10-20T14:00:00Z", "2026-10-23T02:00:00Z")], pack)).toEqual([]);
    expect(carryInFromLogbook([logged("DEC26", "2026-11-28T14:00:00Z", "2026-12-01T02:00:00Z")], pack)).toEqual([]);
  });
  it("is empty without a logbook or the pack's dates", () => {
    expect(carryInFromLogbook(undefined, pack)).toEqual([]);
    expect(carryInFromLogbook([logged("NOV26", "2026-11-28T14:00:00Z", "2026-12-01T02:00:00Z")], { month: "DEC26", bidPeriodStart: null })).toEqual([]);
  });
});
