import { describe, expect, it } from "vitest";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { applyPriorityReview } from "@/lib/brain/review";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

/** Two lines that trade days off against credit — the model starts out caring more about credit. */
const line = (id: string, daysOff: number, credit: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 0, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("A", 18, 70), line("B", 12, 85), line("C", 15, 78)] } as unknown as BidPack;
const crit = (id: string, metric: string, weight: number): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "medium", weight, confidence: 1, label: id, evidence: [], status: "settled" });
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "creditHours", 1), crit("off", "daysOff", 0.5)] };

describe("fitting weights to a pilot's line choices", () => {
  it("raises what the chosen line won on until the model agrees with the choice", () => {
    const r = fitWeightsToChoices(pack, model, [{ preferred: "A", other: "B", strength: "strongly" }]);
    expect(r.agreedBefore).toBe(0);
    expect(r.agreedAfter).toBe(1);
    const w = Object.fromEntries(r.model.criteria.map((c) => [c.id, c.weight]));
    expect(w.off).toBeGreaterThan(w.credit);
    expect(r.changes.map((c) => c.criterionId).sort()).toEqual(["credit", "off"]);
  });

  it("lets a couple of close calls only nudge the weights", () => {
    const r = fitWeightsToChoices(pack, model, [{ preferred: "A", other: "B", strength: "slightly" }]);
    const w = Object.fromEntries(r.model.criteria.map((c) => [c.id, c.weight]));
    // One close call allows about a sixth of the full swing: credit stays the bigger priority.
    expect(w.credit).toBeGreaterThan(w.off);
  });

  it("leaves a model alone when it already agrees, and never moves a weight more than 3× from the interview's", () => {
    expect(fitWeightsToChoices(pack, model, [{ preferred: "B", other: "A", strength: "strongly" }]).changes).toEqual([]);
    const r = fitWeightsToChoices(pack, { ...model, criteria: [crit("credit", "creditHours", 1), crit("off", "daysOff", 0.05)] }, [
      { preferred: "A", other: "B", strength: "strongly" },
      { preferred: "A", other: "C", strength: "strongly" },
    ]);
    const off = r.model.criteria.find((c) => c.id === "off")!.weight;
    const credit = r.model.criteria.find((c) => c.id === "credit")!.weight;
    expect(off / credit).toBeLessThanOrEqual((0.05 * 3) / (1 / 3) + 1e-9);
  });
});

describe("the pilot's review of their priorities", () => {
  it("rescales, drops and confirms, keeping the strongest at 1", () => {
    const reviewed = applyPriorityReview(model, { credit: "less", off: "more" });
    expect(Object.fromEntries(reviewed.criteria.map((c) => [c.id, +c.weight.toFixed(3)]))).toEqual({ credit: 0.688, off: 1 });
    expect(applyPriorityReview(model, { off: "drop" }).criteria.map((c) => c.id)).toEqual(["credit"]);
    expect(applyPriorityReview(model, { off: "right" }).criteria[1].confidence).toBe(1);
  });
});
