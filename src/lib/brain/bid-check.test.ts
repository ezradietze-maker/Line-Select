import { describe, expect, it } from "vitest";
import { bidCheckChoice, bidCheckQuestion, checkedLines } from "@/lib/brain/bid-check";
import { askedDealbreakers, dealbreakerQuestion } from "@/lib/brain/dealbreakers";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const line = (id: string, daysOff: number, credit: number, landings: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 200, totalLandings: landings, totalDepartures: 0 }) as unknown as Line;
const crit = (id: string, metric: string, kind: "more" | "less", weight: number): Criterion => ({ id, metric, shape: { kind }, tier: "high", weight, confidence: 1, label: id, evidence: [], status: "settled" });
// Pay matters most; landings a lot too. Line 1 pays best and tops the list on pay alone, but has the most landings.
const pack = {
  id: "p",
  month: "OCT26",
  base: "MEM",
  aircraft: "B767",
  seat: "FO",
  bidPeriodDays: 28,
  bidPeriodStart: "2026-09-28",
  lines: [line("1", 15, 98, 27), line("2", 15, 80, 8), line("3", 15, 78, 10), line("4", 15, 70, 12), line("5", 15, 60, 35), line("6", 15, 62, 30)],
} as unknown as BidPack;
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("Credit", "creditHours", "more", 1), crit("Fewer landings", "landings", "less", 0.6)] };

describe("bid check", () => {
  it("asks about a top line that does badly on a priority, against the best line below it without that problem", () => {
    const q = bidCheckQuestion(pack, model, [], prepareMetrics(pack), [])!;
    expect(q.line).toBe("1");
    // The alternative sits below it on the list and doesn't share its weak spot.
    const alt = pack.lines.find((l) => l.lineNumber === q.alt)!;
    expect(alt.totalLandings).toBeLessThan(15);
    expect(q.rank).toBeLessThanOrEqual(3);
    expect(q.prompt).toContain("“Fewer landings”");
    expect(q.prompt).toContain("27 landings");
    expect(q.options).toHaveLength(4);
  });

  it("doesn't ask about the same line twice", () => {
    const q = bidCheckQuestion(pack, model, [], prepareMetrics(pack), ["1"]);
    expect(q?.line).not.toBe("1");
  });

  it("turns the verdict into a line choice", () => {
    const q = { line: "1", alt: "2" };
    expect(bidCheckChoice(q, 0)).toEqual({ preferred: "1", other: "2", strength: "slightly" });
    // "Somewhere in the middle" and "Low" don't name which line it belongs below — the brain reads those instead.
    expect(bidCheckChoice(q, 1)).toBeNull();
    expect(bidCheckChoice(q, 2)).toBeNull();
    // A middle check: about right / lower / never.
    expect(bidCheckChoice({ ...q, kind: "middle" }, 0)).toEqual({ preferred: "1", other: "2", strength: "slightly" });
    expect(bidCheckChoice({ ...q, kind: "middle" }, 1)).toBeNull();
    expect(bidCheckChoice({ ...q, kind: "middle" }, 2)).toEqual({ preferred: "2", other: "1", strength: "strongly" });
    expect(bidCheckChoice(q, 3, "Too many landings")).toEqual({ preferred: "2", other: "1", strength: "strongly", why: "Too many landings" });
  });

  it("reads back which lines it already asked about", () => {
    const q = bidCheckQuestion(pack, model, [], prepareMetrics(pack), [])!;
    expect(checkedLines([{ question: q.transcript }, { question: "Something else" }])).toEqual(["1"]);
  });
});

describe("dealbreaker question", () => {
  it("shows the pack's range on the pilot's top priorities", () => {
    const q = dealbreakerQuestion(pack, model, prepareMetrics(pack));
    expect(q.helpText).toContain("Credit: 60 hours to 98 hours");
    expect(q.helpText).toContain("Fewer landings: 8 landings to 35 landings");
    expect(askedDealbreakers([{ question: q.transcript }])).toBe(true);
    expect(askedDealbreakers([{ question: q.prompt }])).toBe(false);
  });

  it("still asks without a model", () => {
    expect(dealbreakerQuestion(pack, null, prepareMetrics(pack)).prompt).toMatch(/rules a line out/);
  });
});
