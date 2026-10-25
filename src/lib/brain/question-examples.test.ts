import { describe, expect, it } from "vitest";
import { examplesTranscript, pickQuestionExamples } from "@/lib/brain/question-examples";
import { prepareMetrics } from "@/lib/metrics/compute";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const crit = (id: string, metric: string, over: Partial<Criterion> = {}): Criterion => ({ id, metric, label: id, shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, evidence: [], status: "settled", ...over });
const model = (criteria: Criterion[]): PilotModel => ({ version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria });
const pm = prepareMetrics(SAMPLE_BID_PACK);

describe("examples for the interview's questions", () => {
  it("offers real lines at both ends of each priority, with the pilot's own figure", () => {
    const ex = pickQuestionExamples(SAMPLE_BID_PACK, model([crit("Days off", "daysOff"), crit("Credit", "creditHours", { weight: 0.5 })]), pm);
    const lines = new Set(SAMPLE_BID_PACK.lines.map((l) => l.lineNumber));
    const daysOff = ex.filter((e) => e.fact.startsWith("Days off:"));
    expect(daysOff).toHaveLength(2);
    expect(daysOff.every((e) => e.kind === "line" && lines.has(e.ref) && e.title === `Line ${e.ref}`)).toBe(true);
    const days = daysOff.map((e) => SAMPLE_BID_PACK.lines.find((l) => l.lineNumber === e.ref)!.daysOff);
    expect(days[0]).toBeGreaterThan(days[1]); // the best end first, then the worst
    expect(ex.map((e) => e.id)).toEqual(ex.map((_, i) => `E${i + 1}`));
  });

  it("offers a trip where one trip shows the priority, and only real ones", () => {
    const ex = pickQuestionExamples(SAMPLE_BID_PACK, model([crit("Legs", "dutiesWithManyLegs", { shape: { kind: "less", fineAt: 0 }, params: { n: 2 } })]), pm);
    const trips = new Set(SAMPLE_BID_PACK.lines.flatMap((l) => l.trips).map(tripKey));
    for (const e of ex.filter((x) => x.kind === "trip")) expect(trips.has(e.ref)).toBe(true);
  });

  it("offers nothing without priorities, and says what was shown in the transcript", () => {
    expect(pickQuestionExamples(SAMPLE_BID_PACK, model([]), pm)).toEqual([]);
    expect(examplesTranscript([{ title: "Line 1004", fact: "Departures: 2" }])).toBe(" (Examples shown: Line 1004 — Departures: 2.)");
    expect(examplesTranscript([])).toBe("");
  });
});
