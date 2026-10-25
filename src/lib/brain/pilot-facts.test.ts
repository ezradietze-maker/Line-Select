import { describe, expect, it } from "vitest";
import { applyPilotFacts, parsePilotFacts } from "@/lib/brain/pilot-facts";
import { withHomeFacts } from "@/lib/brain/model-upgrade";
import type { PilotModel } from "@/types/pilot-model";

const model = (home: PilotModel["home"]): PilotModel => ({ version: 2, home, criteria: [], threads: [], notMeasurable: [], synopsis: "" });

describe("pilot facts", () => {
  it("keeps only the facts given, in a sane range, with the pilot's words for each", () => {
    const f = parsePilotFacts({
      minHomeHours: 24,
      hasCrashPad: "unknown",
      evidence: [{ fact: "minHomeHours", quote: "if I can be home 24 hours I go home", turn: 3 }, { fact: "hasCrashPad", quote: "?", turn: 1 }, { fact: "made-up", quote: "x", turn: 0 }],
    });
    expect(f.values).toEqual({ minHomeHours: 24 });
    expect(f.evidence).toEqual([{ fact: "minHomeHours", quote: "if I can be home 24 hours I go home", turn: 3 }]);
    expect(parsePilotFacts({ minHomeHours: -1, hasCrashPad: "no", evidence: [] }).values).toEqual({ hasCrashPad: false });
    expect(parsePilotFacts({ minHomeHours: 900, hasCrashPad: "yes", evidence: "nope" }).values).toEqual({ hasCrashPad: true });
  });

  it("puts them where the app reads them, and the pilot's own answers on the commute screen still win", () => {
    const read = applyPilotFacts(model({ airports: ["SAN"], commuter: true }), { values: { minHomeHours: 36, hasCrashPad: true }, evidence: [] });
    expect(read.home).toMatchObject({ minHomeHours: 36, hasCrashPad: true });
    expect(read.facts?.values).toEqual({ minHomeHours: 36, hasCrashPad: true });
    expect(withHomeFacts(read, { minHomeHours: 24, hasCrashPad: false }).home).toMatchObject({ minHomeHours: 24, hasCrashPad: false });
    // No known home, no home facts.
    const none = model(null);
    expect(applyPilotFacts(none, { values: { minHomeHours: 24 }, evidence: [] })).toBe(none);
  });
});
