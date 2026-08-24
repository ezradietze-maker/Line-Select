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
  /** -100 = avoid deadheading, +100 = deadheading doesn't matter. */
  deadheadTolerance: number;
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

/** Dimensions a pilot can pin to an exact stated value in the deep round. */
export type ExplicitTargetKey = "daysOff" | "creditHours" | "tripCount";

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
   * Specific layover cities the pilot flagged, keyed by IATA-style code —
   * built from the actual cities present in their uploaded bid pack, not a
   * generic list. Drives the cityPreference scoring dimension.
   */
  cityPreferences: Record<string, CitySentiment>;
  completedAt: string;
}
