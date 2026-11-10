import { describe, expect, it } from "vitest";
import { buildBrainOutcome, computeBrainModel, decideNotes, fleetNotes, guardNotes, MIN_PILOTS, noteLines, parseBrainOutcome, resolveBrainCohort, shareLowerBound, type BrainOutcome } from "@/lib/learning/brain-learning";
import type { Cohort } from "@/lib/learning/cohort";
import type { PilotModel } from "@/types/pilot-model";

const cohort: Cohort = { base: "ANC", aircraft: "B777", seat: "CAP", commute: "commuter", seniority: "middle" };
const model: PilotModel = {
  version: 2, home: null, threads: [], notMeasurable: [], synopsis: "",
  criteria: [
    { id: "a", metric: "baseCommutesNeeded", shape: { kind: "less" }, tier: "high", weight: 1, confidence: 1, label: "Fewer commutes", evidence: [], status: "settled" },
    { id: "b", metric: "baseCommutesNeeded", shape: { kind: "less" }, tier: "low", weight: 0.3, confidence: 1, label: "dup", evidence: [], status: "settled", hardLimit: { op: "max", value: 6 } },
    { id: "c", metric: "creditPerDayAwayFromHome", shape: { kind: "more" }, tier: "medium", weight: 0.456, confidence: 1, label: "Pay per day", evidence: [], status: "settled" },
  ],
};
const outcome = (over: Partial<BrainOutcome> = {}): BrainOutcome =>
  buildBrainOutcome({ month: "OCT26", cohort, checkIn: false, questions: 14, choices: 4, model, cityScores: { HNL: 1, CAN: -0.5 }, review: [{ metric: "creditPerDayAwayFromHome", verdict: "less" }], ...over } as Parameters<typeof buildBrainOutcome>[0]);

describe("what the fleet learns from the story-driven interview", () => {
  it("records the shape of a pilot's model — one entry per measure, never their words", () => {
    const o = outcome();
    expect(o.criteria).toEqual([{ metric: "baseCommutesNeeded", w: 1, hard: true }, { metric: "creditPerDayAwayFromHome", w: 0.46, hard: false }]);
    expect(JSON.stringify(o)).not.toMatch(/Fewer commutes|Pay per day/);
  });

  it("only accepts a well-formed outcome with known measures and bounded values", () => {
    expect(parseBrainOutcome(outcome())).toEqual(outcome());
    const bad = { ...outcome(), criteria: [{ metric: "noSuchMetric", w: 0.5, hard: false }, { metric: "daysOff", w: 7, hard: false }], cities: { HNL: 3, "<x>": 1 } };
    expect(parseBrainOutcome(bad)).toMatchObject({ criteria: [], cities: {} });
    expect(parseBrainOutcome({ ...outcome(), v: 1 })).toBeNull();
    expect(parseBrainOutcome({ ...outcome(), cohort: { ...cohort, commute: "sometimes" } })).toBeNull();
  });

  it("carries the brain version and whether notes were used, and nothing a browser claims about who or when", () => {
    const o = outcome({ model: { ...model, brainVersion: 24, notesUsed: true } } as unknown as Partial<BrainOutcome>);
    expect(o).toMatchObject({ brainVersion: 24, notesUsed: true });
    expect(parseBrainOutcome({ ...o, pilot: "someone-else", at: "1999-01-01" })).not.toHaveProperty("pilot");
  });
});

/** A group of pilots who agree: each confirmed commutes as right, said pay counts less, liked HNL. */
const confirming = (n: number, startDay = 1, over: Partial<BrainOutcome> = {}): BrainOutcome[] =>
  Array.from({ length: n }, (_, i) => ({
    ...outcome({ review: [{ metric: "baseCommutesNeeded", verdict: "right" }, { metric: "creditPerDayAwayFromHome", verdict: "less" }] } as Partial<BrainOutcome>),
    cities: { HNL: 1, CAN: -0.5 },
    pilot: `p${startDay + i}`,
    at: new Date(Date.UTC(2026, 9, startDay + i)).toISOString(),
    ...over,
  }));

describe("fleet notes that decide for themselves", () => {
  it("count only the priorities pilots confirmed, never what the brain read", () => {
    const unconfirmed = confirming(14).map((o) => ({ ...o, review: [] }));
    expect(noteLines(computeBrainModel(unconfirmed, "b", new Date(0)).levels["all"]).filter((l) => l.section === "common")).toEqual([]);
  });

  it("stay off below the minimum number of different pilots", () => {
    const sameOne = confirming(20).map((o) => ({ ...o, pilot: "one-pilot" }));
    const decision = decideNotes(sameOne);
    expect(decision.on).toBe(false);
    expect(decision.reason).toMatch(/1 pilots so far — needs 10/);
  });

  it("switch on when notes from earlier pilots hold for the newest, and the brain then reads them", () => {
    const m = computeBrainModel(confirming(14), "b", new Date(0));
    const level = m.levels["pack:ANC|B777|CAP|commuter"];
    expect(level.notes?.on).toBe(true);
    const notes = fleetNotes(resolveBrainCohort(m, cohort))!;
    expect(notes).toMatch(/From 14 commuting pilots in this same domicile, fleet and seat/);
    expect(notes).toMatch(/\[baseCommutesNeeded\] — 100% of them confirmed it, typical weight 1\.00, a limit for 100%/);
    expect(notes).toMatch(/Credit per day away from home: 100% said it should count less/);
    expect(notes).toMatch(/HNL liked \(avg 1\.0, 14 pilots\); CAN disliked/);
  });

  it("stay off when the newest pilots say otherwise", () => {
    const changed = confirming(3, 20, { review: [{ metric: "baseCommutesNeeded", verdict: "drop" }, { metric: "creditPerDayAwayFromHome", verdict: "right" }], cities: { HNL: -1, CAN: 0.8 } });
    const decision = decideNotes([...confirming(11), ...changed]);
    expect(decision.on).toBe(false);
    expect(decision.reason).toMatch(/of the notes held for the newest 3 pilots/);
  });

  it("leave out a line the group doesn't agree on firmly", () => {
    const split = confirming(14).map((o, i) => ({ ...o, cities: { HNL: i % 2 ? 1 : -1 } }));
    expect(noteLines(computeBrainModel(split, "b", new Date(0)).levels["all"]).some((l) => l.key === "city:HNL")).toBe(false);
  });

  it("switch off when pilots interviewed with them corrected the brain clearly more often", () => {
    const withNotes = confirming(12, 1, { notesUsed: true, review: [{ metric: "baseCommutesNeeded", verdict: "less" }] });
    const without = confirming(12, 13, { notesUsed: false, review: [{ metric: "baseCommutesNeeded", verdict: "right" }] });
    const guard = guardNotes([...withNotes, ...without]);
    expect(guard.harmful).toBe(true);
    expect(guard.reason).toMatch(/corrected the brain more often \(100% vs 0%\)/);
    expect(decideNotes([...withNotes, ...without], guard).on).toBe(false);
    // Too few on either side: no verdict.
    expect(guardNotes([...withNotes.slice(0, 5), ...without]).harmful).toBe(false);
  });

  it("switch off when months ranked with notes went worse clearly more often", () => {
    const flown = [...Array.from({ length: 12 }, () => ({ notesUsed: true, worse: true })), ...Array.from({ length: 12 }, () => ({ notesUsed: false, worse: false }))];
    expect(guardNotes(confirming(14), flown)).toMatchObject({ harmful: true });
  });

  it("put a share at its cautious end, more cautious with fewer pilots", () => {
    expect(shareLowerBound(10, 10)).toBeLessThan(1);
    expect(shareLowerBound(5, 10)).toBeLessThan(shareLowerBound(50, 100));
    expect(shareLowerBound(0, 0)).toBe(0);
    expect(MIN_PILOTS).toBe(10);
  });
});
