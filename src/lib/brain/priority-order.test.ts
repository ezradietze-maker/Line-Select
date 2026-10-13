import { describe, expect, it } from "vitest";
import { ABOUT_EQUAL, applyPriorityPick, priorityOrderQuestion, priorityOrderTranscript } from "./priority-order";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const crit = (id: string, label: string, weight: number, metric: string): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "high", weight, confidence: 0.6, label, evidence: [], status: "settled" });
const model: PilotModel = {
  version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
  criteria: [
    crit("pay", "Pay per day away from home", 1, "creditPerDayAwayFromHome"),
    crit("commute", "Fewer commutes to Anchorage", 0.9, "baseCommutesNeeded"),
    crit("cities", "Layovers in cities you like", 0.6, "layoverValue"),
    crit("legs", "Single-leg duties", 0.3, "extraLegs"),
  ],
};

describe("the priority-order question", () => {
  it("offers their top three in order, plus 'about the same'", () => {
    const q = priorityOrderQuestion(model)!;
    expect(q.options).toEqual(["Pay per day away from home", "Fewer commutes to Anchorage", "Layovers in cities you like", ABOUT_EQUAL]);
    expect(q.criterionIds).toEqual(["pay", "commute", "cities"]);
    expect(priorityOrderTranscript(q)).toContain("(Pay per day away from home / Fewer commutes to Anchorage / Layovers in cities you like)");
  });

  it("never pits two of the same kind against each other", () => {
    const weekends: PilotModel = { ...model, criteria: [crit("we", "Saturdays and Sundays off", 1, "weekendDaysOff"), crit("sat", "Every Saturday off", 0.9, "weekdaysOff"), crit("short", "Short trips", 0.6, "avgTripDays"), crit("legs", "Single-leg duties", 0.3, "extraLegs")] };
    expect(priorityOrderQuestion(weekends)!.criterionIds).toEqual(["we", "short", "legs"]);
  });

  it("isn't asked with fewer than two priorities", () => {
    expect(priorityOrderQuestion({ ...model, criteria: [model.criteria[0]] })).toBeNull();
    expect(priorityOrderQuestion(null)).toBeNull();
  });

  it("makes their pick the strongest priority at once, with every other one clearly below it", () => {
    const m = applyPriorityPick(model, "commute");
    const w = Object.fromEntries(m.criteria.map((c) => [c.id, c.weight]));
    expect(w.commute).toBe(1);
    expect(Math.max(w.pay, w.cities, w.legs)).toBeLessThanOrEqual(0.85);
    expect(w.legs).toBeCloseTo(0.3);
    expect(applyPriorityPick(model, null)).toBe(model);
  });
});
