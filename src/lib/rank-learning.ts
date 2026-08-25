import type { HotelSubscores, LineScore } from "@/lib/scoring";
import type { PreferenceWeights } from "@/types/preferences";

/** Below this, two lines read as too similar on a dimension to justify pinning any part of the correction to it — a coincidence, not a real signal. */
const MIN_MEANINGFUL_GAP = 0.08;

/** A gap this large (or larger) earns the full nudge; smaller gaps scale down toward MIN_NUDGE rather than all getting treated as equally confident. */
const REFERENCE_GAP = 0.5;
const MIN_NUDGE = 6;
const MAX_NUDGE = 22;

/** At most this many weights get adjusted from a single swap — a correction can have more than one real cause, but spreading it across every near-threshold dimension would dilute the signal into noise. */
const MAX_DIMENSIONS_PER_CORRECTION = 2;

/**
 * Dimensions with a direct 1:1 weight to nudge — valid both as a
 * DimensionScore.key and a PreferenceWeights key. `cityPreference` is driven
 * by a whole set of flagged cities rather than one weight, so there's no
 * single honest weight to attribute a correction to — inferring "you must
 * love this specific city" from an indirect ranking signal is a much
 * shakier guess than nudging a magnitude on an axis the pilot already told
 * us about, so it's deliberately left unlearned rather than guessed.
 */
type DirectDimensionKey =
  | "daysOff"
  | "tripLength"
  | "tripCount"
  | "international"
  | "region"
  | "reportTime"
  | "creditHours"
  | "deadheadTolerance";

const DIRECT_DIMENSIONS: DirectDimensionKey[] = [
  "daysOff",
  "tripLength",
  "tripCount",
  "international",
  "region",
  "reportTime",
  "creditHours",
  "deadheadTolerance",
];

/** The five hotel sliders are magnitude-only (0 = doesn't matter, 100 = matters a lot) — there's no "opposite" of caring about a quiet room, so unlike the bipolar dimensions above they're always clamped to [0, 100], never allowed to cross into negative. */
const HOTEL_WEIGHT_KEYS = {
  food: "hotelFood",
  gym: "hotelGym",
  grocery: "hotelGrocery",
  quiet: "hotelQuiet",
  quality: "hotelQuality",
} as const satisfies Record<keyof HotelSubscores, keyof PreferenceWeights>;

const MAGNITUDE_ONLY_KEYS = new Set<keyof PreferenceWeights>(Object.values(HOTEL_WEIGHT_KEYS));

interface Candidate {
  key: keyof PreferenceWeights;
  gap: number;
  /** +1 nudges the weight toward `favored`'s side of the dimension, -1 away from it. */
  direction: 1 | -1;
}

/** Scales a nudge by how clear-cut the two lines' difference actually was — a huge, obvious gap earns close to MAX_NUDGE; one just past the noise floor barely earns more than MIN_NUDGE. */
function nudgeMagnitude(gap: number): number {
  const t = Math.min(1, gap / REFERENCE_GAP);
  return MIN_NUDGE + (MAX_NUDGE - MIN_NUDGE) * t;
}

/** Best single hotel sub-aspect the two lines differ on, if their overall layoverQuality match differed enough to look at in the first place. */
function bestHotelCandidate(favored: LineScore, overtaken: LineScore): Candidate | null {
  const favoredDim = favored.dimensions.find((d) => d.key === "layoverQuality");
  const overtakenDim = overtaken.dimensions.find((d) => d.key === "layoverQuality");
  if (!favoredDim || !overtakenDim || !favoredDim.verified || !overtakenDim.verified) return null;
  if (Math.abs(favoredDim.value - overtakenDim.value) <= MIN_MEANINGFUL_GAP) return null;

  const favoredHotel = favoredDim.hotelBreakdown;
  const overtakenHotel = overtakenDim.hotelBreakdown;
  if (!favoredHotel || !overtakenHotel) return null;

  let best: Candidate | null = null;
  for (const sub of Object.keys(HOTEL_WEIGHT_KEYS) as (keyof HotelSubscores)[]) {
    const a = favoredHotel[sub];
    const b = overtakenHotel[sub];
    if (a === null || b === null) continue;
    const gap = Math.abs(a - b);
    if (gap <= MIN_MEANINGFUL_GAP) continue;
    if (!best || gap > best.gap) {
      // Always toward "matters more" when favored's hotel actually did
      // better on this aspect; toward "matters less" when favored won
      // despite a worse hotel on it — either way informative, since a
      // magnitude-only weight has no other direction to express.
      best = { key: HOTEL_WEIGHT_KEYS[sub], gap, direction: a > b ? 1 : -1 };
    }
  }
  return best;
}

export interface LearnedAdjustment {
  key: keyof PreferenceWeights;
  weight: number;
  /** +1 if this correction increased the weight, -1 if it decreased it — the describeLearn phrase for magnitude-only hotel weights needs this, since their final sign carries no direction information. */
  direction: 1 | -1;
}

export interface ReorderLearnResult {
  weights: PreferenceWeights;
  /** Every weight this correction touched, most-confident first. Empty if nothing stood out clearly enough to learn from. */
  adjustments: LearnedAdjustment[];
}

/**
 * A pilot moving `favored` above `overtaken` (or `overtaken` below
 * `favored`) is a live correction: the current weights scored this pair in
 * the wrong order. Rather than forcing the whole correction onto a single
 * dimension, this finds every dimension the two lines differ on meaningfully
 * (including, when relevant, which specific hotel sub-aspect drives a
 * layoverQuality difference), keeps the strongest two, and nudges each by an
 * amount scaled to how clear-cut that particular gap was — a huge difference
 * moves its weight further than one that barely cleared the noise floor.
 */
export function learnFromReorder(
  weights: PreferenceWeights,
  favored: LineScore,
  overtaken: LineScore
): ReorderLearnResult {
  const candidates: Candidate[] = [];

  for (const key of DIRECT_DIMENSIONS) {
    const favoredDim = favored.dimensions.find((d) => d.key === key);
    const overtakenDim = overtaken.dimensions.find((d) => d.key === key);
    if (!favoredDim || !overtakenDim || !favoredDim.verified || !overtakenDim.verified) continue;

    const gap = Math.abs(favoredDim.value - overtakenDim.value);
    if (gap <= MIN_MEANINGFUL_GAP) continue;
    candidates.push({ key, gap, direction: favoredDim.value > overtakenDim.value ? 1 : -1 });
  }

  const hotelCandidate = bestHotelCandidate(favored, overtaken);
  if (hotelCandidate) candidates.push(hotelCandidate);

  const chosen = candidates.sort((a, b) => b.gap - a.gap).slice(0, MAX_DIMENSIONS_PER_CORRECTION);

  if (chosen.length === 0) {
    return { weights, adjustments: [] };
  }

  const nextWeights = { ...weights };
  const adjustments: LearnedAdjustment[] = [];
  for (const { key, gap, direction } of chosen) {
    const magnitude = nudgeMagnitude(gap);
    const current = nextWeights[key];
    const [floor, ceiling] = MAGNITUDE_ONLY_KEYS.has(key) ? [0, 100] : [-100, 100];
    const nudged = Math.min(ceiling, Math.max(floor, current + direction * magnitude));
    // Already pinned at the floor/ceiling this nudge would push toward — no
    // real change happened, so it's not worth claiming as a learned
    // adjustment (this is common for a hotel weight sitting at 0 when the
    // correction actually argues for caring about it *less*).
    if (nudged === current) continue;
    nextWeights[key] = nudged;
    adjustments.push({ key, weight: nudged, direction });
  }

  return { weights: nextWeights, adjustments };
}
