import { ALL_TARGET_CONFIGS, formatExplicitTarget } from "@/lib/interview-config";
import { EXPLICIT_WEIGHT_IDS } from "@/lib/interview-engine";
import { PHRASES } from "@/lib/preference-summary";
import type { ExplicitWeightKey, PreferenceFact } from "@/types/interview-session";
import type {
  CitySentiment,
  ExplicitTargetKey,
  PreferenceProfile,
  PreferenceWeights,
  RangeTarget,
} from "@/types/preferences";

/**
 * A pilot changing a preference directly (Preferences page, or nudging a
 * slider on the post-interview confirmation screen) has to change the
 * underlying `PreferenceFact`s too — not just `weights`/`explicitTargets`/
 * `cityPreferences`. `finalizeAdaptiveProfile` rebuilds all three purely from
 * facts every cycle, and the next interview carries prior facts forward as
 * "still true" unless the pilot flags them — so an edit that only touched the
 * derived numbers would silently revert itself the next bid cycle, exactly
 * the kind of quiet memory loss the cross-cycle machinery exists to prevent.
 */
export interface ProfileEdits {
  weights?: Partial<PreferenceWeights>;
  /** `null` removes the target entirely. A bare number is a single pinned ideal; a `RangeTarget` is a tolerance band. */
  explicitTargets?: Partial<Record<ExplicitTargetKey, number | RangeTarget | null>>;
  /** `null` clears the city back to "no opinion". */
  cityPreferences?: Record<string, CitySentiment | null>;
  /** The pilot's seniority number — a plain field, not a preference fact. `null` clears it. */
  seniorityNumber?: number | null;
}

const TOPIC_LABELS: Record<ExplicitWeightKey, string> = {
  daysOff: "days off",
  tripLength: "trip length",
  international: "international vs. domestic flying",
  reportTime: "report times",
  creditHours: "credit hours vs. lifestyle",
  deadheadTolerance: "deadhead legs",
  hotelFood: "food near the layover hotel",
  hotelGym: "gym access at the layover hotel",
  hotelGrocery: "grocery access near the layover hotel",
  hotelQuiet: "room noise",
  hotelQuality: "overall hotel quality",
  circadianHealth: "protecting your body clock",
  landings: "landings",
  hotelStandby: "hotel standby",
  riskTolerance: "reaching for hard-to-hold lines",
  adminEffortAppetite: "extra bidding effort",
};

const EXPLICIT_WEIGHT_KEYS = new Set<string>(EXPLICIT_WEIGHT_IDS);

const MANUAL_SOURCE = { kind: "manual-edit" } as const;

function isExplicitWeightKey(key: string): key is ExplicitWeightKey {
  return EXPLICIT_WEIGHT_KEYS.has(key);
}

function weightStatement(key: ExplicitWeightKey, value: number): string {
  if (value === 0) return `No real preference on ${TOPIC_LABELS[key]}.`;
  const phrase = value > 0 ? PHRASES[key].positive : PHRASES[key].negative;
  return `Prefers ${phrase}.`;
}

function weightFact(key: ExplicitWeightKey, value: number, replaced: PreferenceFact[]): PreferenceFact {
  const direction: 1 | -1 = value >= 0 ? 1 : -1;
  // A dealbreaker the pilot flagged in the interview stays a dealbreaker only
  // if they're still leaning the same way — flipping the lean invalidates it.
  const keptDealbreaker =
    value !== 0 &&
    replaced.some(
      (f) => f.severity === "dealbreaker" && f.measurable?.type === "explicit-weight" && f.measurable.direction === direction
    );
  return {
    id: crypto.randomUUID(),
    statement: weightStatement(key, value),
    kind: "measurable",
    measurable: { type: "explicit-weight", key, direction },
    confidence: 1,
    importance: Math.min(1, Math.abs(value) / 100),
    ...(keptDealbreaker ? { severity: "dealbreaker" as const } : {}),
    source: MANUAL_SOURCE,
    turnIndex: 0,
  };
}

function targetStatement(key: ExplicitTargetKey, role: "min" | "ideal" | "max" | undefined, value: number): string {
  const config = ALL_TARGET_CONFIGS.find((c) => c.key === key);
  const formatted = config ? formatExplicitTarget(config, value) : String(value);
  if (role === "min") return `Needs at least ${formatted}.`;
  if (role === "max") return `Wants no more than ${formatted}.`;
  if (role === "ideal") return `Ideal is ${formatted}.`;
  return `Targets ${formatted}.`;
}

function targetFacts(key: ExplicitTargetKey, target: number | RangeTarget, replaced: PreferenceFact[]): PreferenceFact[] {
  const entries: { role: "min" | "ideal" | "max" | undefined; value: number }[] =
    typeof target === "number"
      ? [{ role: undefined, value: target }]
      : (["min", "ideal", "max"] as const)
          .filter((role) => target[role] !== undefined)
          .map((role) => ({ role, value: target[role] as number }));

  return entries.map(({ role, value }) => {
    const hadDealbreakerForRole =
      (role === "min" || role === "max") &&
      replaced.some(
        (f) => f.severity === "dealbreaker" && f.measurable?.type === "explicit-target" && f.measurable.rangeRole === role
      );
    return {
      id: crypto.randomUUID(),
      statement: targetStatement(key, role, value),
      kind: "measurable" as const,
      measurable: { type: "explicit-target" as const, key, value, ...(role ? { rangeRole: role } : {}) },
      confidence: 1,
      importance: 0.8,
      ...(hadDealbreakerForRole ? { severity: "dealbreaker" as const } : {}),
      source: MANUAL_SOURCE,
      turnIndex: 0,
    };
  });
}

function cityFact(code: string, sentiment: CitySentiment, replaced: PreferenceFact[]): PreferenceFact {
  const keptDealbreaker = replaced.some(
    (f) => f.severity === "dealbreaker" && f.measurable?.type === "city-sentiment" && f.measurable.sentiment === sentiment
  );
  return {
    id: crypto.randomUUID(),
    statement: `${sentiment === "love" ? "Loves" : "Wants to avoid"} layovers in ${code}.`,
    kind: "measurable",
    measurable: { type: "city-sentiment", code, sentiment },
    confidence: 1,
    importance: 0.6,
    ...(keptDealbreaker ? { severity: "dealbreaker" as const } : {}),
    source: MANUAL_SOURCE,
    turnIndex: 0,
  };
}

function sameTarget(a: number | RangeTarget | undefined, b: number | RangeTarget | null | undefined): boolean {
  if (a === undefined || b === undefined || b === null) return a === undefined && (b === undefined || b === null);
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.min === b.min && a.ideal === b.ideal && a.max === b.max;
}

export function applyManualEdits(profile: PreferenceProfile, edits: ProfileEdits): PreferenceProfile {
  let facts = profile.discoveredFacts;
  const weights = { ...profile.weights };
  const explicitTargets = { ...profile.explicitTargets };
  const cityPreferences = { ...profile.cityPreferences };

  for (const [rawKey, value] of Object.entries(edits.weights ?? {})) {
    if (value === undefined || !isExplicitWeightKey(rawKey)) continue;
    const key = rawKey;
    if (value === profile.weights[key]) continue;
    const replaced = facts.filter((f) => f.measurable?.type === "explicit-weight" && f.measurable.key === key);
    facts = [...facts.filter((f) => !replaced.includes(f)), weightFact(key, value, replaced)];
    weights[key] = value;
  }

  for (const [rawKey, target] of Object.entries(edits.explicitTargets ?? {})) {
    const key = rawKey as ExplicitTargetKey;
    if (target === undefined || sameTarget(profile.explicitTargets[key], target)) continue;
    const replaced = facts.filter((f) => f.measurable?.type === "explicit-target" && f.measurable.key === key);
    facts = facts.filter((f) => !replaced.includes(f));
    if (target === null) {
      delete explicitTargets[key];
    } else {
      facts = [...facts, ...targetFacts(key, target, replaced)];
      explicitTargets[key] = target;
    }
  }

  for (const [code, sentiment] of Object.entries(edits.cityPreferences ?? {})) {
    if ((profile.cityPreferences[code] ?? null) === sentiment) continue;
    const replaced = facts.filter((f) => f.measurable?.type === "city-sentiment" && f.measurable.code === code);
    facts = facts.filter((f) => !replaced.includes(f));
    if (sentiment === null) {
      delete cityPreferences[code];
    } else {
      facts = [...facts, cityFact(code, sentiment, replaced)];
      cityPreferences[code] = sentiment;
    }
  }

  const seniorityNumber = edits.seniorityNumber === undefined ? profile.seniorityNumber ?? null : edits.seniorityNumber;

  return { ...profile, weights, explicitTargets, cityPreferences, seniorityNumber, discoveredFacts: facts };
}

/** Whether `edits` would change anything at all — drives the Save button's enabled state. */
export function hasEdits(profile: PreferenceProfile, edits: ProfileEdits): boolean {
  const next = applyManualEdits(profile, edits);
  return (
    next.discoveredFacts !== profile.discoveredFacts ||
    JSON.stringify(next.weights) !== JSON.stringify(profile.weights) ||
    JSON.stringify(next.explicitTargets) !== JSON.stringify(profile.explicitTargets) ||
    JSON.stringify(next.cityPreferences) !== JSON.stringify(profile.cityPreferences) ||
    (next.seniorityNumber ?? null) !== (profile.seniorityNumber ?? null)
  );
}
