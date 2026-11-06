import { describe, expect, it } from "vitest";
import { describeSwap, explainSwap } from "@/lib/brain/explain-swap";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const line = (id: string, daysOff: number, credit: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 0, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("A", 18, 70), line("B", 12, 85), line("C", 15, 78), line("D", 18, 84)] } as unknown as BidPack;
const crit = (id: string, label: string, metric: string, weight: number): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "medium", weight, confidence: 1, label, evidence: [], status: "settled" });
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "Credit", "creditHours", 1), crit("off", "Days off", "daysOff", 0.5)] };
const scores = (m: PilotModel) => new Map(scorePackV2(pack, m, {}).map((s) => [s.lineNumber, s]));

describe("why a pilot swapped two lines", () => {
  it("splits the score gap exactly into one share per priority", () => {
    const s = scores(model);
    const e = explainSwap(s.get("A")!, s.get("B")!);
    expect(e.factors.reduce((a, f) => a + f.share, 0)).toBeCloseTo(e.gap, 1);
    expect(e.factors.find((f) => f.criterionId === "off")!.share).toBeGreaterThan(0);
    expect(e.against?.criterionId).toBe("credit");
  });

  it("names the one priority that explains it, contrasted with what the other line was ahead on", () => {
    const s = scores(model);
    const e = explainSwap(s.get("A")!, s.get("B")!);
    expect(e.verdict).toBe("clear");
    expect(e.explains.map((f) => f.criterionId)).toEqual(["off"]);
    expect(describeSwap(e, "A", "B")).toBe("I had B higher on credit (85 vs 70). A wins on days off (18 vs 12) — looks like that counts for more than I had.");
  });

  it("says when the brain already had them that way, and when nothing it tracks explains the swap", () => {
    const s = scores(model);
    expect(explainSwap(s.get("D")!, s.get("A")!).verdict).toBe("agreed");
    // C loses to D on both priorities: no amount of either puts it ahead.
    const e = explainSwap(s.get("C")!, s.get("D")!);
    expect(e.verdict).toBe("unexplained");
    expect(e.explains).toEqual([]);
    expect(describeSwap(e, "C", "D")).toMatch(/Nothing you've told us puts C ahead/);
  });

  it("leaves out a priority the two lines are equal on, however much it counts", () => {
    // A and D both have 18 days off.
    const s = scores(model);
    expect(explainSwap(s.get("A")!, s.get("D")!).factors.map((f) => f.criterionId)).toEqual(["credit"]);
  });

  it("puts a swap over a broken dealbreaker down to the limit, not the priorities", () => {
    const limited: PilotModel = { ...model, criteria: [model.criteria[0], { ...model.criteria[1], hardLimit: { op: "min", value: 14 } }] };
    const s = scores(limited);
    const e = explainSwap(s.get("B")!, s.get("A")!);
    expect(e.verdict).toBe("limit");
    expect(describeSwap(e, "B", "A")).toMatch(/^B breaks your limit on days off/);
  });
});
