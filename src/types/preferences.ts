/**
 * A pilot's stated preferences, built up through the interview.
 * Every slider runs -100..100 where 0 means "no strong preference."
 * Sign/direction meaning is documented per field below.
 */

export interface PreferenceWeights {
  /** -100 = fewer days off is fine, +100 = maximize days off. */
  daysOff: number;
  /** -100 = prefer short trips, +100 = prefer long trips. */
  tripLength: number;
  /** -100 = doesn't mind lots of separate trips, +100 = wants as few, longer trips as possible (fewer commute round-trips). */
  tripCount: number;
  /** -100 = prefer domestic only, +100 = prefer international. */
  international: number;
  /** -100 = prefer Northeast Asia layovers (HKG/ICN/KIX/NRT/PVG/TPE), +100 = prefer Southeast Asia (SIN/BKK/CGK/KUL/etc). Only meaningful when a bid pack actually has both. */
  region: number;
  /** -100 = prefer early reports, +100 = prefer late/evening reports. */
  reportTime: number;
  /** -100 = prefer a lean/minimum line, +100 = prefer max credit hours. */
  creditHours: number;
  /** -100 = avoid deadheading, +100 = deadheading doesn't matter (for a commuter, the high end instead reads as "like having them"). */
  deadheadTolerance: number;
  /**
   * Vestigial — never moved by a bipolar slider (there's no "fewer vs. more
   * departures" spectrum, just a number the pilot pins). Importance for this
   * dimension comes entirely from `explicitTargets.departures` being set.
   */
  departures: number;
  /**
   * The five layover-hotel dimensions below are all one-directional despite
   * the shared -100..100 scale: only magnitude is used (0 = doesn't matter,
   * 100 = matters a lot). There's no meaningful "opposite" of caring about
   * walkable food, for instance — see `weightToImportance`/the
   * `layoverQuality` dimension in scoring.ts. `hotelFood` also covers nearby
   * coffee shops, folded in as one walkable-dining consideration rather than
   * a sixth slider. `hotelQuiet` and `hotelQuality` are review-derived (room
   * noise, and overall cleanliness/service/comfort) rather than
   * nearby-amenity counts.
   */
  hotelFood: number;
  hotelGym: number;
  hotelGrocery: number;
  hotelQuiet: number;
  hotelQuality: number;
}

export const DEFAULT_WEIGHTS: PreferenceWeights = {
  daysOff: 0,
  tripLength: 0,
  tripCount: 0,
  international: 0,
  region: 0,
  reportTime: 0,
  creditHours: 0,
  deadheadTolerance: 0,
  departures: 0,
  hotelFood: 0,
  hotelGym: 0,
  hotelGrocery: 0,
  hotelQuiet: 0,
  hotelQuality: 0,
};

export type QuickQuestionKey =
  | "daysOff"
  | "tripLength"
  | "tripCount"
  | "international"
  | "reportTime"
  | "creditHours";

export type DeepSliderKey =
  | "deadheadTolerance"
  | "region"
  | "hotelFood"
  | "hotelGym"
  | "hotelGrocery"
  | "hotelQuiet"
  | "hotelQuality";

/** Dimensions a pilot can pin to an exact stated value. */
export type ExplicitTargetKey = "daysOff" | "creditHours" | "tripCount" | "departures";

/** A single "would you rather" trade-off answer, -1..1. */
export interface TradeoffAnswer {
  id: string;
  /** -1 = fully picked option A, +1 = fully picked option B, 0 = skipped. */
  value: number;
}

export type CitySentiment = "love" | "avoid";

export interface PreferenceProfile {
  weights: PreferenceWeights;
  /** Whether the pilot completed the optional deeper round. */
  deepRoundCompleted: boolean;
  tradeoffAnswers: TradeoffAnswer[];
  /**
   * Exact stated targets (e.g. "I want 16 days off") that, when present,
   * are used as the match target for that dimension instead of the rough
   * midpoint a -100..100 slider alone implies.
   */
  explicitTargets: Partial<Record<ExplicitTargetKey, number>>;
  /**
   * Whether the pilot commutes to base. Not a scored dimension on its own —
   * it raises the effective importance floor on reportTime and tripCount
   * (an early/late report or an extra trip is a much bigger deal when it
   * costs a commuter an extra hotel night or a missed flight home), even
   * if they left those sliders near neutral. `null` means not asked/skipped.
   */
  isCommuter: boolean | null;
  /**
   * Whether the pilot has a crash pad in domicile. Only meaningful (and only
   * asked) for a commuter — a locally based pilot doesn't need one. When a
   * commuter has no crash pad, an extra separate trip is a bigger real cost
   * (nowhere to stage between duty days), so this raises tripCount's
   * effective importance floor further. `null` means not asked/skipped.
   */
  hasCrashPad: boolean | null;
  /**
   * Specific layover cities the pilot flagged, keyed by IATA-style code —
   * built from the actual cities present in their uploaded bid pack, not a
   * generic list. Drives the cityPreference scoring dimension.
   */
  cityPreferences: Record<string, CitySentiment>;
  completedAt: string;
  /**
   * The implicit layer: per-pilot learned weight for every variable in the
   * implicit taxonomy (see `implicit-dimensions.ts`), keyed by variable id.
   * Unlike `weights` above (seeded by the interview, -100..100, sign fixed
   * by what each slider means), these start at 0 with no assumed direction
   * — drag-and-drop is the only thing that ever moves them, and it can push
   * either way, because nothing about "long turn times" or "hotel chain X"
   * has an inherent good/bad direction the way "more days off" does.
   */
  implicitWeights: Record<string, number>;
  /**
   * 0-1 confidence per implicit variable, independent of its weight — a
   * variable can have a weight of exactly 0 with high confidence (learned
   * that it truly doesn't matter to this pilot) or a nonzero weight with
   * low confidence (one or two data points, could still be noise). Confidence
   * grows with each pairwise update and shrinks the effective learning rate,
   * so the model stops overreacting to a variable once it's seen enough
   * evidence about it.
   */
  implicitConfidence: Record<string, number>;
}
