import { describe, expect, it } from "vitest";
import { plannerLines } from "@/components/tools/ToolsScreen";
import { lookupPack } from "@/lib/flights/client";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const credit: Criterion = { id: "c", metric: "creditHours", shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, label: "Credit", evidence: [], status: "settled" } as unknown as Criterion;
const model = { version: 2, home: null, criteria: [credit], threads: [], notMeasurable: [], synopsis: "" } as PilotModel;

describe("the commute planner's lines", () => {
  const byModel = rankLinesWithTrips(SAMPLE_BID_PACK, model, { pack: lookupPack(SAMPLE_BID_PACK) });

  it("carry My Rankings' numbers and order, not the model's alone", () => {
    // My Rankings has the model's #1 and #2 the other way round (a hotel, a flight, or a line moved by hand).
    const [first, second] = byModel;
    const place = new Map(byModel.map((s, i) => [s.lineId, i + 1]));
    place.set(first.lineId, 2);
    place.set(second.lineId, 1);
    const lines = plannerLines(SAMPLE_BID_PACK, model, place);
    expect(lines[0]).toEqual({ lineId: second.lineId, lineNumber: second.lineNumber, place: 1 });
    expect(lines[1]).toEqual({ lineId: first.lineId, lineNumber: first.lineNumber, place: 2 });
  });

  it("are the lines whose flights are looked up, however My Rankings orders them", () => {
    const reversed = new Map(byModel.map((s, i) => [s.lineId, byModel.length - i]));
    expect(new Set(plannerLines(SAMPLE_BID_PACK, model, reversed).map((l) => l.lineId))).toEqual(new Set(byModel.slice(0, 30).map((s) => s.lineId)));
  });
});
