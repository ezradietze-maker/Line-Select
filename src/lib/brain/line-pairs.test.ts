import { describe, expect, it } from "vitest";
import { pickLinePairs } from "@/lib/brain/line-pairs";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const line = (id: string, daysOff: number, credit: number, tafb = 200, landings = 0): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: tafb, totalLandings: landings, totalDepartures: 0 }) as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("1", 18, 70), line("2", 14, 85), line("3", 18, 85), line("4", 10, 60)] } as unknown as BidPack;
const crit = (id: string, metric: string, kind: "more" | "less" = "more"): Criterion => ({ id, metric, shape: { kind }, tier: "high", weight: 1, confidence: 1, label: id, evidence: [], status: "settled" });
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("Days off", "daysOff"), crit("Credit", "creditHours")] };

describe("picking line pairs to put to the pilot", () => {
  it("pairs close lines that win on different priorities, never one that simply dominates", () => {
    const pairs = pickLinePairs(pack, model, prepareMetrics(pack), new Set());
    expect(pairs.map((p) => [p.a, p.b].sort().join("-"))).toEqual(["1-2"]);
    expect(pairs[0].tension).toContain("is better on Days off (18 days vs 14 days)");
    expect(pairs[0].tension).toContain("is better on Credit (85 hours vs 70 hours)");
  });

  it("with more priorities, picks pairs that differ on several at once, each line winning some", () => {
    const four: PilotModel = { ...model, criteria: [...model.criteria, crit("Time away", "tafbHours", "less"), crit("Fewer landings", "landings", "less")] };
    const lines = [line("1", 18, 70, 180, 10), line("2", 14, 85, 230, 20), line("3", 16, 78, 260, 12), line("4", 10, 60, 300, 30), line("5", 17, 72, 190, 22)];
    const wide = { ...pack, lines } as unknown as BidPack;
    const pairs = pickLinePairs(wide, four, prepareMetrics(wide), new Set());
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.differences!.length).toBeGreaterThanOrEqual(3);
      expect(p.differences!.some((d) => d.better === "a")).toBe(true);
      expect(p.differences!.some((d) => d.better === "b")).toBe(true);
    }
  });

  it("puts each trade to the pilot at most twice", () => {
    const [p] = pickLinePairs(pack, model, prepareMetrics(pack), new Set());
    expect(pickLinePairs(pack, model, prepareMetrics(pack), new Set(), 3, [p.trade])).toHaveLength(1);
    expect(pickLinePairs(pack, model, prepareMetrics(pack), new Set(), 3, [p.trade, p.trade])).toEqual([]);
  });

  it("skips pairs already compared", () => {
    expect(pickLinePairs(pack, model, prepareMetrics(pack), new Set(["2|1"]))).toEqual([]);
  });

  it("offers lines the pilot hasn't seen yet before ones they have", () => {
    const wide = { ...pack, lines: [...pack.lines, line("5", 16, 76), line("6", 14, 82)] } as BidPack;
    const pairs = pickLinePairs(wide, model, prepareMetrics(wide), new Set(["1|9"]), 1);
    expect(pairs[0].a === "1" || pairs[0].b === "1").toBe(false);
  });
});
