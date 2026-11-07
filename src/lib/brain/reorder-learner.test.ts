import { describe, expect, it } from "vitest";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { choicesFromSwap } from "@/lib/brain/profile-model";
import { learnFromChoices, swapPairWeights } from "@/lib/brain/reorder-learner";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, LineChoice, PilotModel } from "@/types/pilot-model";

const line = (id: string, daysOff: number, credit: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 0, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = {
  id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28",
  lines: [line("A", 18, 70), line("B", 12, 85), line("C", 15, 78), line("D", 17, 72), line("E", 13, 83)],
} as unknown as BidPack;
const crit = (id: string, metric: string, weight: number): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "medium", weight, confidence: 1, label: id, evidence: [], status: "settled" });
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "creditHours", 1), crit("off", "daysOff", 0.5)] };
const ratio = (m: PilotModel) => m.criteria.find((c) => c.id === "off")!.weight / m.criteria.find((c) => c.id === "credit")!.weight;

describe("learning from a pilot's line choices and swaps", () => {
  it("gives the same model as the old fit when there are only interview choices", () => {
    const asked: LineChoice[] = [
      { preferred: "A", other: "B", strength: "strongly" },
      { preferred: "C", other: "E", strength: "slightly" },
    ];
    expect(ratio(learnFromChoices(pack, model, asked).model)).toBeCloseTo(ratio(fitWeightsToChoices(pack, model, asked).model), 3);
  });

  it("reads a swap as the top line over the run and the run over the bottom line, most of it on the swapped pair", () => {
    const pairs = choicesFromSwap(["A", "C", "B"], "s1");
    expect(pairs.map((c) => `${c.preferred}>${c.other}`)).toEqual(["A>B", "A>C", "C>B"]);
    expect(swapPairWeights(pairs, 2, 0.5)).toEqual([1, 0.5, 0.5]);
    expect(swapPairWeights(choicesFromSwap(["A", "B"], "s2"), 2, 0.5)).toEqual([2]);
  });

  it("learns from swaps that agree with each other, and is surer of what they point to", () => {
    // Days-off lines put over credit lines, again and again.
    const swaps = [choicesFromSwap(["A", "B"], "s1"), choicesFromSwap(["D", "E"], "s2"), choicesFromSwap(["A", "E"], "s3"), choicesFromSwap(["D", "B"], "s4")].flat();
    const r = learnFromChoices(pack, model, swaps);
    expect(ratio(r.model)).toBeGreaterThan(ratio(model) * 1.2);
    expect(r.uncertainty.off).toBeLessThan(0.5);
  });

  it("barely moves for swaps that contradict each other", () => {
    const consistent = [choicesFromSwap(["A", "B"], "s1"), choicesFromSwap(["D", "E"], "s2"), choicesFromSwap(["A", "E"], "s3"), choicesFromSwap(["D", "B"], "s4")].flat();
    const mixed = [choicesFromSwap(["A", "B"], "s1"), choicesFromSwap(["E", "D"], "s2"), choicesFromSwap(["A", "E"], "s3"), choicesFromSwap(["B", "D"], "s4")].flat();
    const moved = (ch: LineChoice[]) => Math.abs(Math.log(ratio(learnFromChoices(pack, model, ch).model) / ratio(model)));
    expect(moved(mixed)).toBeLessThan(moved(consistent) / 2);
    expect(learnFromChoices(pack, model, mixed).swapNoise!).toBeGreaterThan(learnFromChoices(pack, model, consistent).swapNoise!);
  });
});
