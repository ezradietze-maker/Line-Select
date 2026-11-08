import { describe, expect, it } from "vitest";
import { MIN_SHARED_PILOTS } from "@/lib/award-history";
import { distinctPilots, heldByFrom, summarizeBands, trustedHolders, type AwardRow } from "@/lib/server/award-aggregate";

const row = (over: Partial<AwardRow> = {}): AwardRow => ({
  pilotHash: "p1",
  seniorityRank: 10,
  seniorityTotalPilots: 100,
  outcome: "line",
  lineNumber: "1001",
  daysOff: 15,
  totalCreditHours: 70,
  holderShown: true,
  ...over,
});
const pilots = (n: number, over: Partial<AwardRow> = {}): AwardRow[] =>
  Array.from({ length: n }, (_, i) => row({ pilotHash: `p${i}`, seniorityRank: i + 1, lineNumber: String(1001 + i), daysOff: 14 + (i % 3), ...over }));

describe("group numbers", () => {
  it("are held back until enough different pilots stand behind them", () => {
    const short = summarizeBands(pilots(MIN_SHARED_PILOTS - 1));
    expect(short.bands[0]).toEqual({ reports: MIN_SHARED_PILOTS - 1, avgDaysOff: null, avgCreditHours: null, lineRate: null });
    const enough = summarizeBands(pilots(MIN_SHARED_PILOTS));
    expect(enough.bands[0].avgDaysOff).not.toBeNull();
    expect(enough.bands[0].lineRate).toBe(1);
  });

  it("don't count one pilot over many months as many pilots", () => {
    const oneMan = Array.from({ length: 12 }, () => row({ pilotHash: "same" }));
    expect(distinctPilots(oneMan)).toBe(1);
    expect(summarizeBands(oneMan).bands[0]).toMatchObject({ reports: 12, avgDaysOff: null, lineRate: null });
  });

  it("leave reserve and other outcomes out of the averages, but in the line rate", () => {
    const rows = [...pilots(5), row({ pilotHash: "r", outcome: "reserve", lineNumber: null, daysOff: null, totalCreditHours: null, seniorityRank: 8 })];
    const band = summarizeBands(rows).bands[0];
    expect(band.reports).toBe(6);
    expect(band.lineRate).toBeCloseTo(0.83, 2);
    expect(band.avgCreditHours).toBe(70);
  });

  it("carry nothing about any one report", () => {
    const text = JSON.stringify(summarizeBands(pilots(8, { pilotHash: undefined })));
    expect(text).not.toMatch(/hash|line(Number)?"|seniorityRank|1001|"id"|submitted/i);
  });

  it("keep each report in exactly one slice, so slices can't be subtracted to single one out", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row({ pilotHash: `p${i}`, seniorityRank: i + 1 }));
    const { bands, totalReports } = summarizeBands(rows);
    expect(bands.reduce((n, b) => n + b.reports, 0)).toBe(totalReports);
  });
});

describe("who held what", () => {
  it("shows nothing until enough pilots have agreed", () => {
    expect(heldByFrom(pilots(MIN_SHARED_PILOTS - 1))).toEqual([]);
    expect(heldByFrom(pilots(MIN_SHARED_PILOTS))).toHaveLength(MIN_SHARED_PILOTS);
  });

  it("never shows a pilot who didn't say yes, and they don't count toward the group", () => {
    const rows = [...pilots(5), row({ pilotHash: "no", seniorityRank: 50, lineNumber: "2000", holderShown: false })];
    expect(heldByFrom(rows).map((h) => h.lineNumber)).not.toContain("2000");
    expect(heldByFrom([...pilots(4), row({ pilotHash: "no", seniorityRank: 50, lineNumber: "2000", holderShown: false })])).toEqual([]);
  });

  it("gives only the line and the place on the list", () => {
    for (const h of heldByFrom(pilots(5))) expect(Object.keys(h).sort()).toEqual(["bidPosition", "lineNumber"]);
  });

  it("only lists lines, not reserve", () => {
    const rows = [...pilots(5), row({ pilotHash: "r", outcome: "reserve", lineNumber: null, seniorityRank: 50 })];
    expect(heldByFrom(rows)).toHaveLength(5);
  });

  it("believes neither report when two claim the same line or the same place", () => {
    const sameLine = [row({ pilotHash: "a", seniorityRank: 1, lineNumber: "1" }), row({ pilotHash: "b", seniorityRank: 2, lineNumber: "1" }), row({ pilotHash: "c", seniorityRank: 3, lineNumber: "3" })];
    expect(trustedHolders(sameLine).map((r) => r.pilotHash)).toEqual(["c"]);
    const samePlace = [row({ pilotHash: "a", seniorityRank: 1, lineNumber: "1" }), row({ pilotHash: "b", seniorityRank: 1, lineNumber: "2" })];
    expect(trustedHolders(samePlace)).toEqual([]);
  });

  it("drops below the bar the moment a withdrawal takes it there", () => {
    const rows = pilots(5);
    expect(heldByFrom(rows)).toHaveLength(5);
    expect(heldByFrom(rows.filter((r) => r.pilotHash !== "p2"))).toEqual([]);
  });
});
