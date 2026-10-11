import { describe, expect, it } from "vitest";
import { describeModel, describeShape, formatValue } from "@/lib/brain/describe";
import type { PilotModel } from "@/types/pilot-model";

describe("saying the model back in plain words", () => {
  it("formats values the way a pilot reads them", () => {
    expect(formatValue(1, { unit: "commutes" })).toBe("1 commute");
    expect(formatValue(3, { unit: "commutes" })).toBe("3 commutes");
    expect(formatValue(0.5, { unit: "share" })).toBe("50%");
    expect(formatValue(150, { unit: "minute of day" })).toBe("02:30");
    expect(formatValue(4.25, { unit: "stars (1–5, 5 easiest)" })).toBe("4.3★");
  });

  it("describes each shape in real units", () => {
    expect(describeShape({ kind: "less", fineAt: 0 }, { unit: "duties" })).toBe("Less is better: 0 duties is ideal");
    expect(describeShape({ kind: "target", ideal: 15, tolerance: 2 }, { unit: "days" })).toBe("Best around 15 days (give or take 2 days)");
    expect(describeShape({ kind: "range", min: 540 }, { unit: "minute of day" })).toBe("At least 09:00");
    expect(describeShape({ kind: "perOccurrence", costEach: 0.25 }, { unit: "duties" })).toBe("Each one costs about 25% of this priority");
  });

  it("orders priorities by their real share of the score, and states dealbreakers", () => {
    const model: PilotModel = {
      version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
      criteria: [
        { id: "a", metric: "creditHours", shape: { kind: "more" }, tier: "low", weight: 0.25, confidence: 1, label: "Pay", evidence: [], status: "settled" },
        { id: "b", metric: "requestedDatesWorked", params: { dates: ["2026-10-10"] }, shape: { kind: "less", fineAt: 0 }, tier: "must", weight: 1, confidence: 1, label: "Wedding", evidence: [{ quote: "my daughter's wedding", turn: 0 }], status: "settled", hardLimit: { op: "max", value: 0 } },
        { id: "x", metric: "noSuchMetric", shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, label: "Ghost", evidence: [], status: "settled" },
      ],
    };
    const d = describeModel(model);
    expect(d.map((c) => [c.id, c.influence])).toEqual([["b", 80], ["a", 20]]);
    expect(d[0]).toMatchObject({ measuredAs: "Wanted dates not off (2026-10-10)", dealbreaker: "Dealbreaker: any at all rules a line out", quotes: ["my daughter's wedding"] });
  });
});
