import { describe, expect, it } from "vitest";
import { logbookStats, loggedMonthFrom, withCheckIn, withLoggedMonth, withoutLoggedMonth } from "@/lib/logbook";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const pack = { ...SAMPLE_BID_PACK, bidPeriodStart: "2026-09-28", bidPeriodDays: 28 };
const line = pack.lines[0];
const profile = { discoveredFacts: [] } as unknown as PreferenceProfile;

describe("the logbook", () => {
  it("keeps the held line's own month's numbers and cities with the entry", () => {
    const m = loggedMonthFrom(pack, "line", line, { rankedAt: 3, seniority: { rank: 40, totalPilots: 200 }, now: new Date("2026-10-01T00:00:00Z") });
    expect(m).toMatchObject({ base: pack.base, month: pack.month, outcome: "line", lineNumber: line.lineNumber, daysOff: line.daysOff, rankedAt: 3, seniorityRank: 40 });
    expect(m.layoverCities!.length).toBeGreaterThan(0);
    const reserve = loggedMonthFrom(pack, "reserve", line);
    expect(reserve.lineNumber).toBeNull();
    expect(reserve.layoverCities).toEqual([]);
  });

  it("logs one entry a month — a second log of the same month replaces the first — and keeps how it flew", () => {
    const a = loggedMonthFrom(pack, "line", line, { now: new Date("2026-10-01T00:00:00Z") });
    const b = loggedMonthFrom(pack, "reserve", null, { now: new Date("2026-10-02T00:00:00Z") });
    const p = withLoggedMonth(withLoggedMonth(profile, a), b);
    expect(p.logbook).toHaveLength(1);
    expect(p.logbook![0].outcome).toBe("reserve");
    const checked = withCheckIn(p, b.id, "better", { bestTrip: " #76 ", note: "" });
    expect(checked.logbook![0].checkIn).toMatchObject({ feel: "better", bestTrip: "#76" });
    expect(checked.logbook![0].checkIn!.note).toBeUndefined();
    expect(withoutLoggedMonth(checked, b.id).logbook).toEqual([]);
  });

  it("adds the months up: averages, cities, top-5 share and seniority over time", () => {
    const m1 = { ...loggedMonthFrom(pack, "line", line, { rankedAt: 2, seniority: { rank: 50, totalPilots: 200 }, now: new Date("2026-09-01T00:00:00Z") }), id: "1", month: "SEP26", layoverCities: ["HNL", "OAK", "HNL"] };
    const m2 = { ...loggedMonthFrom(pack, "line", line, { rankedAt: 9, seniority: { rank: 40, totalPilots: 200 }, now: new Date("2026-10-01T00:00:00Z") }), id: "2", month: "OCT26", layoverCities: ["HNL"] };
    const s = logbookStats([m2, m1]);
    expect(s.months).toBe(2);
    expect(s.cities[0]).toEqual({ code: "HNL", layovers: 3 });
    expect(s.topFiveShare).toBe(0.5);
    expect(s.seniority).toEqual([{ month: "SEP26", percentile: 0.25 }, { month: "OCT26", percentile: 0.2 }]);
  });
});
