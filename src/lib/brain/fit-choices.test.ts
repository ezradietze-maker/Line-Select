import { describe, expect, it } from "vitest";
import { fitWeightsToChoices, shareChanges } from "@/lib/brain/fit-choices";
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

  it("counts a swap the pilot makes again, where a repeated interview answer counts once", () => {
    const drag = { preferred: "A", other: "B", strength: "slightly", direct: true } as const;
    const w = (r: ReturnType<typeof fitWeightsToChoices>, id: string) => r.model.criteria.find((c) => c.id === id)!.weight;
    const off = (r: ReturnType<typeof fitWeightsToChoices>) => w(r, "off") / w(r, "credit");
    expect(off(fitWeightsToChoices(pack, model, [drag, drag]))).toBeGreaterThan(off(fitWeightsToChoices(pack, model, [drag])));
    const asked = { preferred: "A", other: "B", strength: "slightly" } as const;
    expect(off(fitWeightsToChoices(pack, model, [asked, asked]))).toBeCloseTo(off(fitWeightsToChoices(pack, model, [asked])), 9);
  });

  it("leaves a pair a dealbreaker decides out of the fit", () => {
    // B breaks a days-off limit; the pilot puts it above A anyway. No reweighting can explain that — the limit is the question.
    const limited: PilotModel = { ...model, criteria: [model.criteria[0], { ...model.criteria[1], hardLimit: { op: "min", value: 14 } }] };
    const r = fitWeightsToChoices(pack, limited, [{ preferred: "B", other: "A", strength: "strongly", direct: true }]);
    expect(r.heldByLimit).toHaveLength(1);
    expect(r.model).toBe(limited);
  });

  it("reports a change only where a priority's share of the weight moved, not where rescaling moved it on paper", () => {
    const halved: PilotModel = { ...model, criteria: model.criteria.map((c) => ({ ...c, weight: c.weight / 2 })) };
    expect(shareChanges(model, halved)).toEqual([]);
    const moved = shareChanges(model, { ...model, criteria: [model.criteria[0], { ...model.criteria[1], weight: 1 }] });
    expect(moved.map((c) => [c.criterionId, c.to > c.from])).toEqual([
      ["credit", false],
      ["off", true],
    ]);
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
