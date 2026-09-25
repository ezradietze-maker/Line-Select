import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
import type { DimensionKey } from "@/lib/scoring";

/**
 * The five pilot-facing groupings the Satisfaction Index breaks down into —
 * "82% satisfaction" alone isn't enough; a pilot should see "excellent on
 * home time, mediocre on pay." Every one of the 10 fixed `DimensionKey`s and
 * all 22 `IMPLICIT_VARIABLES` ids maps to exactly one of these (see
 * `categoryFor` below) — this is an editorial taxonomy, not a mechanically
 * derived one, so the boundaries/names are a real design choice, not a
 * technical inevitability.
 */
export type SatisfactionCategory =
  | "timeAndHomeLife"
  | "compensation"
  | "tripCharacter"
  | "commuteAndDeadhead"
  | "restAndCircadian";

export const SATISFACTION_CATEGORY_LABELS: Record<SatisfactionCategory, string> = {
  timeAndHomeLife: "Time & Home Life",
  compensation: "Compensation",
  tripCharacter: "Trip Character",
  commuteAndDeadhead: "Commute & Deadhead Fit",
  restAndCircadian: "Rest & Circadian Health",
};

/** Every ordered category, for iterating in a stable, intentional display order. */
export const SATISFACTION_CATEGORIES: SatisfactionCategory[] = [
  "timeAndHomeLife",
  "compensation",
  "tripCharacter",
  "commuteAndDeadhead",
  "restAndCircadian",
];

const FIXED_DIMENSION_CATEGORIES: Record<DimensionKey, SatisfactionCategory> = {
  daysOff: "timeAndHomeLife",
  departures: "timeAndHomeLife",
  creditHours: "compensation",
  tripLength: "tripCharacter",
  international: "tripCharacter",
  cityPreference: "tripCharacter",
  layoverQuality: "tripCharacter",
  reportTime: "commuteAndDeadhead",
  deadheadTolerance: "commuteAndDeadhead",
  landings: "tripCharacter",
  hotelStandby: "timeAndHomeLife",
  circadianHealth: "restAndCircadian",
};

/**
 * Maps each `ImplicitVariable.category` (the 6-value taxonomy already
 * authored per variable in `implicit-dimensions.ts`, oriented around how
 * each variable is *computed*) down to the 5 pilot-facing
 * `SatisfactionCategory` buckets (oriented around what a pilot actually
 * cares about) — reusing that existing per-variable metadata rather than
 * hand-mapping all 22 ids individually.
 */
const IMPLICIT_CATEGORY_MAP: Record<string, SatisfactionCategory> = {
  restRecovery: "timeAndHomeLife",
  financial: "compensation",
  layover: "tripCharacter",
  dutyStructure: "tripCharacter",
  workload: "commuteAndDeadhead",
  circadian: "restAndCircadian",
};

const IMPLICIT_VARIABLE_CATEGORIES = new Map(
  IMPLICIT_VARIABLES.map((v) => [v.id, IMPLICIT_CATEGORY_MAP[v.category]] as const)
);

/**
 * A dimension key is either one of the 10 fixed `DimensionKey`s or one of
 * the 22 open implicit-catalog ids sharing the same `DimensionScore.key`
 * field (see that field's own doc comment in `scoring.ts`) — this covers
 * both without the caller needing to know which kind it's looking at.
 * Falls back to `"tripCharacter"` for a truly unknown id (should never
 * happen — every real dimension key is one of the 32 above) rather than
 * throwing, matching this codebase's existing "never crash on a display
 * lookup" convention (see `MatchBar.tsx`'s `labelFor`).
 */
export function categoryFor(key: DimensionKey | string): SatisfactionCategory {
  if (key in FIXED_DIMENSION_CATEGORIES) return FIXED_DIMENSION_CATEGORIES[key as DimensionKey];
  return IMPLICIT_VARIABLE_CATEGORIES.get(key) ?? "tripCharacter";
}
