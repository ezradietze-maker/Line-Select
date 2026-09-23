import { describe, expect, it } from "vitest";
import { finalizeAdaptiveProfile } from "@/lib/interview-engine";
import { applyManualEdits, hasEdits } from "@/lib/profile-edits";
import type { PreferenceFact } from "@/types/interview-session";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

function weightFact(key: string, direction: 1 | -1, importance: number, extra: Partial<PreferenceFact> = {}): PreferenceFact {
  return {
    id: `w-${key}-${direction}-${importance}`,
    statement: `Interview said something about ${key}.`,
    kind: "measurable",
    measurable: { type: "explicit-weight", key: key as never, direction },
    confidence: 0.9,
    importance,
    source: { kind: "adaptive-question", questionId: "q" },
    turnIndex: 1,
    ...extra,
  };
}

function profileWith(
  facts: PreferenceFact[],
  extra: { cityPreferencesSeed?: Record<string, "love" | "avoid"> } = {}
): PreferenceProfile {
  return finalizeAdaptiveProfile({ facts, transcript: [], isCommuter: false, hasCrashPad: null, ...extra });
}

describe("applyManualEdits — weights", () => {
  it("replaces the old interview fact with one fact carrying the new value, and updates the derived weight", () => {
    const profile = profileWith([weightFact("daysOff", 1, 0.55)]);
    const edited = applyManualEdits(profile, { weights: { daysOff: 20 } });
    const facts = edited.discoveredFacts.filter((f) => f.measurable?.type === "explicit-weight" && f.measurable.key === "daysOff");
    expect(facts).toHaveLength(1);
    expect(facts[0].source).toEqual({ kind: "manual-edit" });
    expect(facts[0].importance).toBeCloseTo(0.2);
    expect(edited.weights.daysOff).toBe(20);
  });

  it("leaves everything alone, by reference, when nothing actually changed", () => {
    const profile = profileWith([weightFact("daysOff", 1, 0.55)]);
    const edited = applyManualEdits(profile, { weights: { daysOff: profile.weights.daysOff } });
    expect(edited.discoveredFacts).toBe(profile.discoveredFacts);
    expect(hasEdits(profile, { weights: { daysOff: profile.weights.daysOff } })).toBe(false);
  });

  it("records a neutral setting as a real importance-0 fact, not an absent one", () => {
    const profile = profileWith([weightFact("tripLength", 1, 0.4)]);
    const edited = applyManualEdits(profile, { weights: { tripLength: 0 } });
    const fact = edited.discoveredFacts.find((f) => f.measurable?.type === "explicit-weight" && f.measurable.key === "tripLength");
    expect(fact?.importance).toBe(0);
    expect(edited.weights.tripLength).toBe(0);
  });

  it("handles a negative lean and a magnitude-only key", () => {
    const profile = profileWith([]);
    const edited = applyManualEdits(profile, { weights: { reportTime: -40, hotelQuiet: 70 } });
    expect(edited.weights.reportTime).toBe(-40);
    expect(edited.weights.hotelQuiet).toBe(70);
    const quiet = edited.discoveredFacts.find((f) => f.measurable?.type === "explicit-weight" && f.measurable.key === "hotelQuiet");
    expect(quiet?.measurable).toMatchObject({ direction: 1 });
  });

  it("keeps a dealbreaker only while the lean points the same way", () => {
    const profile = profileWith([weightFact("international", -1, 0.8, { severity: "dealbreaker" })]);
    const sameWay = applyManualEdits(profile, { weights: { international: -50 } });
    expect(sameWay.discoveredFacts.find((f) => f.severity === "dealbreaker")).toBeDefined();
    const flipped = applyManualEdits(profile, { weights: { international: 50 } });
    expect(flipped.discoveredFacts.find((f) => f.severity === "dealbreaker")).toBeUndefined();
  });

  it("ignores keys that aren't explicit-weight dimensions (departures is target-only)", () => {
    const profile = profileWith([]);
    const edited = applyManualEdits(profile, { weights: { departures: 50 } });
    expect(edited.weights.departures).toBe(DEFAULT_WEIGHTS.departures);
    expect(edited.discoveredFacts).toBe(profile.discoveredFacts);
  });

  it("survives the next cycle's fold — the edit doesn't silently revert when facts are re-derived", () => {
    const profile = profileWith([weightFact("daysOff", 1, 0.9), weightFact("creditHours", -1, 0.3)]);
    const edited = applyManualEdits(profile, { weights: { daysOff: 15, creditHours: 60 } });
    const refolded = finalizeAdaptiveProfile({
      facts: edited.discoveredFacts,
      transcript: [],
      isCommuter: false,
      hasCrashPad: null,
    });
    expect(refolded.weights.daysOff).toBeCloseTo(15);
    expect(refolded.weights.creditHours).toBeCloseTo(60);
  });
});

describe("applyManualEdits — explicit targets", () => {
  it("writes a tolerance band as one fact per role and re-folds to the same band", () => {
    const profile = profileWith([]);
    const edited = applyManualEdits(profile, { explicitTargets: { daysOff: { min: 12, ideal: 14, max: 16 } } });
    const roles = edited.discoveredFacts
      .filter((f) => f.measurable?.type === "explicit-target")
      .map((f) => (f.measurable as { rangeRole?: string }).rangeRole)
      .sort();
    expect(roles).toEqual(["ideal", "max", "min"]);
    const refolded = finalizeAdaptiveProfile({ facts: edited.discoveredFacts, transcript: [], isCommuter: false, hasCrashPad: null });
    expect(refolded.explicitTargets.daysOff).toEqual({ min: 12, ideal: 14, max: 16 });
  });

  it("supports a bare pinned number and removal with null", () => {
    const profile = profileWith([]);
    const pinned = applyManualEdits(profile, { explicitTargets: { circadianTolerance: 2 } });
    expect(pinned.explicitTargets.circadianTolerance).toBe(2);
    const cleared = applyManualEdits(pinned, { explicitTargets: { circadianTolerance: null } });
    expect(cleared.explicitTargets.circadianTolerance).toBeUndefined();
    expect(cleared.discoveredFacts.some((f) => f.measurable?.type === "explicit-target")).toBe(false);
  });

  it("carries a floor's dealbreaker flag across an edit of the same role", () => {
    const floor: PreferenceFact = {
      id: "floor",
      statement: "Needs at least 12 days off.",
      kind: "measurable",
      measurable: { type: "explicit-target", key: "daysOff", value: 12, rangeRole: "min" },
      confidence: 1,
      importance: 0.9,
      severity: "dealbreaker",
      source: { kind: "adaptive-question", questionId: "q" },
      turnIndex: 1,
    };
    const profile = profileWith([floor]);
    const edited = applyManualEdits(profile, { explicitTargets: { daysOff: { min: 13 } } });
    const minFact = edited.discoveredFacts.find((f) => f.measurable?.type === "explicit-target" && f.measurable.rangeRole === "min");
    expect(minFact?.severity).toBe("dealbreaker");
  });
});

describe("applyManualEdits — cities", () => {
  it("adds, changes and clears a city, leaving qualitative facts alone", () => {
    const why: PreferenceFact = {
      id: "why",
      statement: "Loves HNL because of the beach.",
      kind: "qualitative",
      confidence: 1,
      importance: 0.7,
      source: { kind: "adaptive-question", questionId: "q" },
      turnIndex: 1,
      cityReason: { code: "HNL", category: "weather" },
    };
    const profile = profileWith([why], { cityPreferencesSeed: { HNL: "love" } });
    const edited = applyManualEdits(profile, { cityPreferences: { HNL: "avoid", CDG: "love" } });
    expect(edited.cityPreferences).toEqual({ HNL: "avoid", CDG: "love" });
    expect(edited.discoveredFacts.find((f) => f.id === "why")).toBeDefined();
    const cleared = applyManualEdits(edited, { cityPreferences: { HNL: null } });
    expect(cleared.cityPreferences).toEqual({ CDG: "love" });
  });

  it("re-folds to the edited city map", () => {
    const profile = profileWith([]);
    const edited = applyManualEdits(profile, { cityPreferences: { ANC: "avoid" } });
    const refolded = finalizeAdaptiveProfile({ facts: edited.discoveredFacts, transcript: [], isCommuter: false, hasCrashPad: null });
    expect(refolded.cityPreferences).toEqual({ ANC: "avoid" });
  });
});
