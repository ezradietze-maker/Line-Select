import { describe, expect, it } from "vitest";
import { prepareMetrics } from "@/lib/metrics/compute";
import { HARD_LIMIT_CAP, homeParams, scorePackV2, spreadOf, utilityOf } from "@/lib/scoring-v2/score";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const line = (id: string, daysOff: number, credit: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 200, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = (lines: Line[]) => ({ id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines }) as unknown as BidPack;
const crit = (over: Partial<Criterion>): Criterion => ({ id: "c", metric: "daysOff", shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, label: "c", evidence: [], status: "settled", ...over });
const model = (criteria: Criterion[]): PilotModel => ({ version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria });

describe("scoring v2", () => {
  it("keeps lowering utility past a stated worst point, gently and down to a floor", () => {
    const shape = { kind: "less" as const, fineAt: 2, worstAt: 6 };
    const spread = { lo: 1, hi: 10 };
    expect(utilityOf(6, shape, spread, 0.25)).toBe(0);
    expect(utilityOf(8, shape, spread, 0.25)).toBeCloseTo(-0.125, 6);
    expect(utilityOf(8, shape, spread, 0.25)).toBeGreaterThan(utilityOf(10, shape, spread, 0.25));
    expect(utilityOf(60, shape, spread, 0.25)).toBe(-0.5);
    // With no slope past the anchor, everything beyond it ties at zero, as before.
    expect(utilityOf(10, shape, spread, 0)).toBeCloseTo(0, 9);
  });

  it("caps a line that breaks a dealbreaker", () => {
    const lines = [line("1", 18, 80), line("2", 16, 80), line("3", 14, 80), line("4", 12, 80)];
    const m = model([crit({ hardLimit: { op: "min", value: 13 } })]);
    const s = new Map(scorePackV2(pack(lines), m, { pack: prepareMetrics(pack(lines)) }).map((x) => [x.lineNumber, x]));
    expect(s.get("4")!.violations).toHaveLength(1);
    expect(s.get("4")!.score).toBeCloseTo(s.get("4")!.uncapped * HARD_LIMIT_CAP, 1);
  });

  it("doesn't cap with a 'dealbreaker' that would rule out most of the pack — it's misread, not one the pilot bids by", () => {
    const lines = [line("1", 18, 80), line("2", 16, 80), line("3", 14, 80), line("4", 12, 80)];
    // At least 17 days off rules out three lines in four.
    const m = model([crit({ hardLimit: { op: "min", value: 17 } })]);
    const s = scorePackV2(pack(lines), m, { pack: prepareMetrics(pack(lines)) });
    expect(s.every((x) => x.violations.length === 0)).toBe(true);
  });

  it("still caps for dates the pilot must have off, however many lines that rules out", () => {
    // Day 12 of a period starting Sep 28 is Oct 10: only line 1 has it off.
    const withCalendar = (l: Line, off: number[]) => ({ ...l, gridOffDays: off }) as Line;
    const lines = [withCalendar(line("1", 18, 80), [12]), withCalendar(line("2", 16, 80), [3]), withCalendar(line("3", 14, 80), [4]), withCalendar(line("4", 12, 80), [5])];
    const m = model([crit({ id: "d", metric: "requestedDatesWorked", params: { dates: ["2026-10-10"] }, shape: { kind: "less", fineAt: 0 }, hardLimit: { op: "max", value: 0 } })]);
    const s = new Map(scorePackV2(pack(lines), m, { pack: prepareMetrics(pack(lines)) }).map((x) => [x.lineNumber, x.violations.length]));
    expect([...s.values()]).toEqual([0, 1, 1, 1]);
  });
});

describe("homeParams", () => {
  it("passes the pilot's hours-at-home rule and crash pad to every measure that reads them", () => {
    const home = { airports: ["SAN"], commuter: true, minHomeHours: 48, hasCrashPad: true };
    expect(homeParams({ version: 2, home, criteria: [], threads: [], notMeasurable: [], synopsis: "" })).toEqual({ homeAirports: ["SAN"], minHomeHours: 48, hasCrashPad: true });
  });
});

describe("spreadOf", () => {
  it("puts the bad end of a few-valued count like departures at the pack's worst line, not the 5% mark", () => {
    // Departures across a month: mostly 3 and 4, a few 2s and one 5.
    const values = [2, 2, ...Array(20).fill(3), ...Array(20).fill(4), 5];
    expect(spreadOf(values, { kind: "less" })).toEqual({ lo: 2, hi: 4 });
    expect(spreadOf(values, { kind: "less" }, { badEndAtWorst: true })).toEqual({ lo: 2, hi: 5 });
  });
});

describe("below a fine number", () => {
  it("still prefers fewer, where the measure says so, and leaves the rest of the scale as it was", () => {
    const shape = { kind: "less", fineAt: 2, worstAt: 6 } as const;
    const spread = { lo: 0, hi: 8 };
    expect(utilityOf(0, shape, spread, 0, 0.5)).toBe(1);
    expect(utilityOf(1, shape, spread, 0, 0.5)).toBe(0.75);
    expect(utilityOf(2, shape, spread, 0, 0.5)).toBe(0.5);
    expect(utilityOf(4, shape, spread, 0, 0.5)).toBe(0.25);
    expect(utilityOf(6, shape, spread, 0, 0.5)).toBe(0);
    // Without it, everything up to the fine number is as good as it gets.
    expect(utilityOf(0, shape, spread)).toBe(1);
    expect(utilityOf(2, shape, spread)).toBe(1);
  });
});
