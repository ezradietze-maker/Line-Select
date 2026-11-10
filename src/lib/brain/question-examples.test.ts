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
    const daysOff = ex.filter((e) => e.priority === "Days off");
    expect(daysOff.every((e) => /^\d+ days off$/.test(e.fact))).toBe(true);
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

  it("never offers a trip or line that's mostly hotel standby, unless the priority is about standby", () => {
    const pack = structuredClone(SAMPLE_BID_PACK);
    const best = pickQuestionExamples(pack, model([crit("Days off", "daysOff")]), pm)[0].ref;
    for (const t of pack.lines.find((l) => l.lineNumber === best)!.trips) t.standbyDays = t.days;
    const ex = pickQuestionExamples(pack, model([crit("Days off", "daysOff")]), prepareMetrics(pack));
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.some((e) => e.ref === best)).toBe(false);
  });

  it("offers nothing without priorities, and says what was shown in the transcript", () => {
    expect(pickQuestionExamples(SAMPLE_BID_PACK, model([]), pm)).toEqual([]);
    expect(examplesTranscript([{ title: "Line 1004", fact: "2 departures", priority: "Few departures" }])).toBe(" (Examples shown: Line 1004 — 2 departures (Few departures).)");
    expect(examplesTranscript([])).toBe("");
  });
});
