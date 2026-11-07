import { describe, expect, it } from "vitest";
import { addDragChoices, baseModelOf, choicesFromDrag, describeChanges, withModel, withoutDrag } from "@/lib/brain/profile-model";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const line = (id: string, daysOff: number, credit: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 200, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("A", 18, 70), line("B", 12, 85), line("C", 15, 78)] } as unknown as BidPack;
const crit = (id: string, metric: string, weight: number): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "medium", weight, confidence: 1, label: id, evidence: [], status: "settled" });
const base: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "creditHours", 1), crit("off", "daysOff", 0.3)] };
const profile: PreferenceProfile = {
  weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: false, hasCrashPad: null, cityPreferences: {},
  completedAt: "2026-10-11T00:00:00.000Z", implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [],
  pilotModel: base, brainInterview: { exchanges: [], choices: [], reviewedModel: base },
};

describe("keeping the pilot model current after the interview", () => {
  it("turns a drag into choices that refit from the confirmed base, not from the last fit", () => {
    const choices = choicesFromDrag([{ favored: "A", overtaken: "B" }]);
    expect(choices).toEqual([{ preferred: "A", other: "B", strength: "slightly", direct: true }]);
    const once = withModel(profile, pack, { choices });
    const w = (p: PreferenceProfile, id: string) => p.pilotModel!.criteria.find((c) => c.id === id)!.weight;
    expect(w(once.profile, "off")).toBeGreaterThan(0.3 * 1.01);
    expect(once.profile.brainInterview?.reviewedModel).toBe(base);
    expect(describeChanges(once.changes)).toMatch(/counting more: off/);
    // The same choices again change nothing: the fit always starts from the base.
    const twice = withModel(once.profile, pack, { choices });
    expect(w(twice.profile, "off")).toBeCloseTo(w(once.profile, "off"), 6);
  });

  it("lets the latest swap of two lines win, and takes a swap's choices back when it's undone", () => {
    const first = choicesFromDrag([{ favored: "A", overtaken: "B" }], "s1");
    const flipped = addDragChoices(first, choicesFromDrag([{ favored: "B", overtaken: "A" }], "s2"));
    // Only the latest counts; the older one is set aside, and undoing the latest brings it back.
    expect(flipped.filter((c) => !c.supersededBy).map((c) => `${c.preferred}>${c.other}`)).toEqual(["B>A"]);
    expect(withoutDrag(flipped, "s2")).toEqual(first);
    const again = addDragChoices(first, choicesFromDrag([{ favored: "A", overtaken: "B" }], "s3"));
    expect(again).toHaveLength(2);
    expect(withoutDrag(again, "s3")).toEqual(first);
  });

  it("keeps a choice set aside when it's undone out of order and a later swap still reverses it", () => {
    let c = choicesFromDrag([{ favored: "A", overtaken: "B" }], "d1");
    c = addDragChoices(c, choicesFromDrag([{ favored: "B", overtaken: "A" }], "d2"));
    c = addDragChoices(c, choicesFromDrag([{ favored: "A", overtaken: "B" }], "d3"));
    c = addDragChoices(c, choicesFromDrag([{ favored: "B", overtaken: "A" }], "d4"));
    const live = withoutDrag(c, "d2").filter((x) => !x.supersededBy).map((x) => `${x.preferred}>${x.other}`);
    expect(live).toEqual(["B>A"]);
  });

  it("uses a new base when the pilot edits a priority, keeping their choices", () => {
    const edited = { ...base, criteria: base.criteria.map((c) => (c.id === "off" ? { ...c, weight: 1 } : c)) };
    const r = withModel(profile, pack, { base: edited });
    expect(baseModelOf(r.profile)).toBe(edited);
    expect(r.profile.pilotModel!.criteria.find((c) => c.id === "off")!.weight).toBe(1);
  });

  it("lets a priority the pilot set by hand win over what their choices suggest", () => {
    // A choice for the high-credit line would pull days off down; the pilot pins days off at the top anyway.
    const r = withModel(profile, pack, { choices: choicesFromDrag([{ favored: "B", overtaken: "A" }]), pins: { off: 1 } });
    const w = Object.fromEntries(r.profile.pilotModel!.criteria.map((c) => [c.id, c.weight]));
    expect(w.off).toBe(1);
    expect(w.credit).toBe(1);
    expect(r.profile.brainInterview?.pins).toEqual({ off: 1 });
  });

  it("falls back to the model itself for a profile saved before the base was kept", () => {
    expect(baseModelOf({ ...profile, brainInterview: undefined })).toBe(base);
    expect(describeChanges([])).toBeNull();
  });
});
