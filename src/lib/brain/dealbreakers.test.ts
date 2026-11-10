import { describe, expect, it } from "vitest";
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

describe("the bottom-of-the-list question", () => {
  it("shows the pack's range on the pilot's top priorities", () => {
    const q = dealbreakerQuestion(pack, model, prepareMetrics(pack));
    expect(q.prompt).toBe("Is there anything that would put a line at the bottom of your list?");
    expect(q.helpText).toContain("In this pack, lines run 60 to 98 credit hours and 8 to 35 landings.");
    expect(q.transcript).toContain("Credit: 60 to 98 credit hours; Fewer landings: 8 to 35 landings");
    expect(askedDealbreakers([{ question: q.transcript }])).toBe(true);
    expect(askedDealbreakers([{ question: q.prompt }])).toBe(false);
  });

  it("still asks without a model", () => {
    expect(dealbreakerQuestion(pack, null, prepareMetrics(pack)).prompt).toMatch(/bottom of your list/);
  });

  it("still knows it asked, in an interview saved before it was reworded", () => {
    expect(askedDealbreakers([{ question: "Dealbreakers: Is there anything that rules a line out for you?" }])).toBe(true);
  });
});
