import { describe, expect, it } from "vitest";
import { logbookStats, loggedMonthFrom, withCheckIn, withLoggedMonth, withoutLoggedMonth } from "@/lib/logbook";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { Line, Trip } from "@/types/bidpack";
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

describe("the logbook's order", () => {
  it("is by the month, newest first, whenever each was logged — and the seniority over time oldest month first", () => {
    const at = (month: string, rank: number, when: string) => ({ ...loggedMonthFrom(pack, "line", line, { seniority: { rank, totalPilots: 200 }, now: new Date(when) }), id: month, month });
    // November logged when its award came out; October only afterwards, caught up on, and December 2026 after January 2027's.
    const nov = at("NOV26", 50, "2026-10-20T00:00:00Z");
    const oct = at("OCT26", 60, "2026-11-02T00:00:00Z");
    const jan = at("JAN27", 30, "2026-12-20T00:00:00Z");
    const dec = at("DEC26", 40, "2026-12-21T00:00:00Z");
    const p = [nov, oct, jan, dec].reduce((acc, m) => withLoggedMonth(acc, m), profile);
    expect(p.logbook!.map((m) => m.month)).toEqual(["JAN27", "DEC26", "NOV26", "OCT26"]);
    expect(logbookStats(p.logbook!).seniority.map((s) => s.month)).toEqual(["OCT26", "NOV26", "DEC26", "JAN27"]);
  });
});

describe("carryOut: what next month's carry-in needs", () => {
  const pack = { id: "p", base: "MEM", aircraft: "B767", seat: "CAP" as const, month: "NOV26", bidPeriodStart: "2026-10-26", bidPeriodDays: 28 };
  const duty = (startMinutes: number, endMinutes: number, layover: boolean) => ({
    reportTimeLocal: "0800",
    startMinutes,
    legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "0900", depTimeGmt: "1500", arrAirport: "HKG", arrTimeLocal: "1100", arrTimeGmt: "1700", blockHours: 2, startMinutes: startMinutes + 60, endMinutes, depTimeZulu: "", arrTimeZulu: "" }],
    layover: layover ? { city: "HKG", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 24, startMinutes: endMinutes, endMinutes: endMinutes + 1440 } : null,
  });
  const trip = (startDayIndex: number, number: string): Trip => ({
    id: number, pairingNumber: number, days: 3, layoverCities: [], layoverDetails: [], reportTime: "early", international: true, deadheadLegs: 0, creditHours: 22, landings: 2, tafbHours: 60, departures: 2,
    schedule: [duty(0, 600, true), duty(2040, 3600, false)], zuluAnchor: "", startDayIndex,
  });
  const lineOf = (trips: Trip[]): Line => ({ id: "l", lineNumber: "1", trips, daysOff: 13, totalCreditHours: 44, totalTafbHours: 120, totalLandings: 4, totalDepartures: 4 });

  it("keeps the trip that runs past the month's end, with its real times and duties, and nothing else", () => {
    const entry = loggedMonthFrom(pack, "line", lineOf([trip(3, "12"), trip(27, "99")]));
    expect(entry.carryOut?.map((t) => t.label)).toEqual(["Trip 99"]);
    const t = entry.carryOut![0];
    expect(Date.parse(t.release) - Date.parse(t.report)).toBe(60 * 3_600_000);
    expect(t.international).toBe(true);
    expect(t.duties).toHaveLength(2);
    expect(t.duties[1].end).toBe(t.release);
  });
  it("is absent when nothing carries", () => {
    expect(loggedMonthFrom(pack, "line", lineOf([trip(3, "12")])).carryOut).toBeUndefined();
    expect(loggedMonthFrom(pack, "reserve", null).carryOut).toBeUndefined();
  });
});
