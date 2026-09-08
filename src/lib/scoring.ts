import { computeCircadianAssessment, computeCumulativeCircadianAssessment, computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import type { CumulativeCircadianAssessment } from "@/lib/circadian";
import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
// Type-only for the same reason as the ProfileRichness import below — no
// runtime dependency on `line-history-storage.ts` exists or is needed here.
import type { LineSnapshot } from "@/lib/line-history-storage";
// Type-only: `interview-engine.ts` imports (a real value) from `rank-learning.ts`,
// which imports types back from this file — a value-level import here would
// complete a real circular dependency. A type-only import is erased at
// compile time and never executes, so it can't participate in that cycle;
// the actual `assessProfileRichness()` call happens in the caller
// (page.tsx/ResultsView), which passes the result in as `profileRichness`.
import type { ProfileRichness } from "@/lib/interview-engine";
import {
  categoryFor,
  SATISFACTION_CATEGORIES,
  SATISFACTION_CATEGORY_LABELS,
  type SatisfactionCategory,
} from "@/lib/satisfaction-categories";
import { hasRedEyeLeg } from "@/lib/trip-analytics";
import type { BidPack, Line } from "@/types/bidpack";
import type { HotelAmenitySummary, ReviewSentiment, ReviewSummary, ReviewThemeKey } from "@/types/hotel";
import type { MeasurableBinding, PreferenceFact } from "@/types/interview-session";
import type { CitySentiment, PreferenceProfile, PreferenceWeights, RangeTarget } from "@/types/preferences";

/**
 * Everything the layoverQuality dimension needs about one real assigned
 * hotel — nearby-amenity counts and the review-derived read on it, plus its
 * star rating as a fallback quality signal when no review themes could be
 * extracted. Keyed the same way `hotel-client.ts` keys its lookups:
 * `"<city>|<hotel name>"`.
 */
export interface HotelQualityEntry {
  amenities: HotelAmenitySummary | null;
  reviewSummary: ReviewSummary | null;
  rating: number | null;
}
export type HotelQualityData = Record<string, HotelQualityEntry>;

/**
 * Scoring engine.
 *
 * Every line is reduced to a handful of normalized 0-1 metrics describing
 * its real attributes. Each metric is compared against the pilot's stated
 * target (derived from their -100..100 preference weight, an explicit
 * pinned value, or — for city preference — a fixed "more is better" target)
 * and turned into a 0-1 dimension score. Dimension scores are combined with
 * weights (importance) into a single 0-100 match score.
 *
 * Metrics are normalized against the min/max seen across the bid pack being
 * scored, so scores stay meaningful whatever the underlying line data looks
 * like (real bid packs vary a lot in scale from base to base).
 */

export type DimensionKey =
  | "daysOff"
  | "tripLength"
  | "international"
  | "cityPreference"
  | "reportTime"
  | "creditHours"
  | "deadheadTolerance"
  | "departures"
  | "layoverQuality"
  | "circadianHealth"
  | "landings";

/** Dimensions driven by a -100..100 slider weight (everything except cityPreference, which is driven by a set of flagged cities instead). */
type WeightedDimensionKey = keyof PreferenceWeights;

/**
 * Below this, there isn't enough real evidence yet to let a learned
 * implicit weight move a line's actual score — mirrors the threshold
 * `rank-learning.ts`'s `MIN_CONFIDENCE_TO_EXPLAIN` already uses for the
 * separate "why" explanatory surface (kept as its own local constant here,
 * not imported, since `rank-learning.ts` already imports types from this
 * file — importing a value back the other way would make the two modules
 * circularly dependent).
 */
const MIN_CONFIDENCE_FOR_IMPLICIT_SCORING = 0.15;

export interface DimensionScore {
  /**
   * One of the fixed `DimensionKey`s for an explicit dimension, or an
   * `IMPLICIT_VARIABLES` id (a plain string, not a member of `DimensionKey`)
   * for a dimension the adaptive interview or drag-and-drop learner
   * discovered mattered to this pilot — see `isFixedDimensionKey` for how
   * callers tell the two apart. This is the concrete mechanism behind the
   * "open list" of scoreable dimensions: the fixed union never grows, but a
   * `DimensionScore` can carry any id from the real, code-backed implicit
   * catalog too.
   */
  key: DimensionKey | string;
  /** 0-1, how well this line matches the pilot's target on this dimension. */
  match: number;
  /** 0-1, this line's raw normalized value on this dimension. */
  value: number;
  /** 0-1, the pilot's target value implied by their preference weight. */
  target: number;
  /** Absolute weight (0-1) used to combine this dimension into the total. */
  importance: number;
  /**
   * False when this value comes from an estimated (unverified) trip rather
   * than a confirmed trip-by-trip breakdown — see `Line.estimated`. Still
   * scored (an estimate is better than nothing), but callers should flag
   * it rather than present it as a confirmed fact.
   */
  verified: boolean;
  /** Only present on `layoverQuality` — this line's five hotel sub-aspects, unblended, for the drag-to-swap learner to drill into. */
  hotelBreakdown?: HotelSubscores | null;
}

export interface LineScore {
  line: Line;
  /** The Satisfaction Index, 0-100 — already capped when `violatedDealbreakers` is non-empty (see `DEALBREAKER_SCORE_CAP`). */
  score: number;
  dimensions: DimensionScore[];
  topDimensions: DimensionScore[];
  explanation: string;
  /** Mirrors `line.estimated` for convenience. */
  estimated: boolean;
  /** A sub-index per `SatisfactionCategory` — computed from the same per-dimension data as `score`, pre-dealbreaker-cap (a category can honestly read well even when `score` itself is capped for an unrelated dealbreaker). */
  categoryScores: Record<SatisfactionCategory, { score: number; label: string }>;
  /** Named, specific reasons the index went up — more than `explanation`'s own 1-2-item cap, for an expanded breakdown view. */
  contributors: SatisfactionFactor[];
  /** Named, specific reasons the index went down. */
  detractors: SatisfactionFactor[];
  /** Empty for the overwhelming majority of lines/profiles. Non-empty means this line violates something the pilot was unambiguous about refusing — `score` is capped accordingly, and this should be surfaced prominently, not folded quietly into the average. */
  violatedDealbreakers: DealbreakerViolation[];
  /** A stated dealbreaker this line does NOT violate, but sits close enough to that it's worth flagging as real risk — a stated floor of 20 days off on a line with exactly 21, or a match just above the violation threshold. Never conflated with `violatedDealbreakers`: these two lists are mutually exclusive by construction. */
  nearMissDealbreakers: DealbreakerNearMiss[];
  /** Up to 3 of the pilot's own qualitative statements that this specific line's real data actually confirms the relevance of (a shared city, a red-eye they said they'd avoid, etc.) — narrative context tying the index back to the interview conversation, not a generic dimension list. */
  qualitativeTieIns: string[];
  /**
   * Null for the top-scoring line itself, or when the gap to the top line is
   * negligible (<0.5 points) — nothing meaningful to close. Otherwise, a
   * concrete statement of the smallest realistic single-dimension change
   * that would likely make this line the top pick, using real units for a
   * dimension with a clean, denormalizable one (`daysOff`, `creditHours`,
   * `departures`, `landings`, `tripLength`) and a qualitative direction-only
   * phrase for everything else (a blended composite like `layoverQuality`,
   * a discrete count like `cityPreference`, or any implicit-catalog
   * dimension) — see `computeCounterfactual`'s own doc comment for why a
   * numeric claim there would be fabricated precision, not a real one.
   */
  counterfactual: string | null;
  /**
   * How much to trust this line's `score` as a real read on this pilot,
   * not just how the dimensions happen to have shaked out — a score built
   * from a 6-fact profile means something different from one built on an
   * 18-turn interview, even at the identical number. Same value on every
   * `LineScore` in one `rankLines` call, since it describes the pilot's
   * profile, not any one line. Absent (not defaulted to "thorough") when
   * the caller didn't supply `profileRichness` to `scoreBidPack`/`rankLines`
   * — callers that don't care about this yet see no behavior change.
   */
  confidenceLevel: ProfileRichness["level"] | null;
  /** Null unless the caller supplied `priorTopLines` AND this line's dimension shape is genuinely close to one of the pilot's remembered prior-cycle favorites — see `historicalConsistencyNote`. */
  historicalNote: string | null;
  /** Null when this line's trip placement isn't confirmed real (see `hasRealTripPlacement` in `lib/circadian.ts`) or it has fewer than two trips to compare — never an approximated recovery window built on unverified calendar position. */
  cumulativeCircadian: CumulativeCircadianAssessment | null;
  /** Null unless the pilot gave a hotel-related reason for a city this line touches AND a real review summary is on file for the hotel assigned there — see `hotelReviewTieInForLine`. */
  hotelReviewTieIn: HotelReviewTieIn | null;
}

/**
 * When a line's trips are estimated (see `Line.estimated`), everything
 * about the trip's *shape* is a guess built from whole-month totals — only
 * daysOff and creditHours are excluded, since those come straight from the
 * line's own printed totals and stay exact even on an estimated line.
 */
const UNVERIFIED_WHEN_ESTIMATED: DimensionKey[] = [
  "tripLength",
  "international",
  "cityPreference",
  "reportTime",
  "deadheadTolerance",
  "departures",
  "layoverQuality",
  "circadianHealth",
];

interface LineMetrics {
  daysOff: number;
  avgTripLength: number;
  internationalShare: number;
  reportLean: number;
  creditHours: number;
  deadheadPerTrip: number;
  /** Line-level total, not averaged — mirrors `creditHours` below. */
  totalDepartures: number;
  /** Line-level total, exact even on an estimated line (see `Line.totalLandings`'s own doc comment) — same honesty tier as daysOff/creditHours. */
  totalLandings: number;
}

function computeRawMetrics(line: Line): LineMetrics {
  const tripDivisor = line.trips.length || 1;
  const avgTripLength = line.trips.reduce((s, t) => s + t.days, 0) / tripDivisor;
  const internationalShare =
    line.trips.filter((t) => t.international).length / tripDivisor;

  // Report-time lean: early=0, afternoon=0.5, evening=1, averaged.
  const reportValue = { early: 0, afternoon: 0.5, evening: 1 } as const;
  const reportLean =
    line.trips.reduce((s, t) => s + reportValue[t.reportTime], 0) / tripDivisor;

  const deadheadPerTrip =
    line.trips.reduce((s, t) => s + t.deadheadLegs, 0) / tripDivisor;

  return {
    daysOff: line.daysOff,
    avgTripLength,
    internationalShare,
    reportLean,
    creditHours: line.totalCreditHours,
    deadheadPerTrip,
    totalDepartures: line.totalDepartures,
    totalLandings: line.totalLandings,
  };
}

/** +1 per trip touching a loved city, -1 per trip touching an avoided one. A trip touching both nets to 0 for that trip. */
function computeCityScore(line: Line, cityPreferences: Record<string, CitySentiment>): number {
  if (Object.keys(cityPreferences).length === 0) return 0;
  return line.trips.reduce((sum, trip) => {
    const loved = trip.layoverCities.some((c) => cityPreferences[c] === "love");
    const avoided = trip.layoverCities.some((c) => cityPreferences[c] === "avoid");
    return sum + (loved ? 1 : 0) - (avoided ? 1 : 0);
  }, 0);
}

/**
 * A line-level circadian health value in 0-1 (1 = best), averaged across
 * whichever of the line's trips have a real assessment (see
 * lib/circadian.ts) — stars 1-5 map linearly to 0-1. Null when none of the
 * line's trips have a verified schedule to score, so the caller can be
 * honest about "no real data" rather than guessing a neutral value.
 */
function computeCircadianHealthScore(
  line: Line,
  homeBaseOffsetMinutes: number | null,
  consecutiveTolerance?: number | null
): number | null {
  const values = line.trips
    .map((t) => computeCircadianAssessment(t, homeBaseOffsetMinutes, consecutiveTolerance))
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .map((a) => (a.stars - 1) / 4);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const REVIEW_SENTIMENT_SCORE: Record<ReviewSentiment, number> = {
  positive: 1,
  mixed: 0.5,
  negative: 0,
};

/** Null when the reviews didn't say enough about this theme to call it either way — distinct from a mediocre 0.5, so it can be left out of an average rather than dragging it down. */
function reviewThemeScore(summary: ReviewSummary | null, theme: ReviewThemeKey): number | null {
  const sentiment = summary?.themes[theme];
  return sentiment ? REVIEW_SENTIMENT_SCORE[sentiment] : null;
}

const GENERAL_QUALITY_THEMES: ReviewThemeKey[] = [
  "cleanliness",
  "service",
  "sleepComfort",
  "breakfast",
  "safety",
  "walkability",
];

/**
 * Overall review-based quality (everything except room noise, which is its
 * own dimension): the average of whichever general-quality themes the
 * reviews actually supported, falling back to the hotel's Google star
 * rating — already real, verified data — when no theme could be extracted
 * at all (e.g. no reviews were available to analyze).
 */
function reviewQualityScore(hotel: HotelQualityEntry | undefined): number | null {
  if (!hotel) return null;
  const scored = GENERAL_QUALITY_THEMES.map((t) => reviewThemeScore(hotel.reviewSummary, t)).filter(
    (s): s is number => s !== null
  );
  if (scored.length > 0) return scored.reduce((a, b) => a + b, 0) / scored.length;
  if (hotel.rating !== null) return normalize(hotel.rating, 1, 5);
  return null;
}

/** A hotel's five layoverQuality sub-scores, each already 0-1: the three amenity counts normalized across every hotel in this bid pack (a raw count has no inherent scale), and the two review-derived scores, which are meaningful on their own. */
export interface HotelSubscores {
  food: number;
  gym: number;
  grocery: number;
  /** Null = no review signal on this theme at all, not "neutral." */
  quiet: number | null;
  quality: number | null;
}

/**
 * Nearby third-party gyms are a real, verified count, but a pilot asking
 * about "gym" mostly means "can I work out without leaving the hotel" — once
 * reviewers actually say whether the property's own gym is any good, that
 * review-derived read is weighted above the raw nearby count rather than
 * just averaged in beside it.
 */
export function gymScore(normalizedNearbyCount: number, reviewSummary: ReviewSummary | null): number {
  const onSite = reviewThemeScore(reviewSummary, "onSiteGym");
  if (onSite === null) return normalizedNearbyCount;
  return normalizedNearbyCount * 0.4 + onSite * 0.6;
}

/** Every distinct assigned (city, hotel) pair in this bid pack, mapped to its normalized layoverQuality sub-scores — computed once and reused across every line. */
function computeHotelSubscores(bidPack: BidPack, data: HotelQualityData): Record<string, HotelSubscores> {
  const keys = new Set<string>();
  for (const line of bidPack.lines) {
    for (const trip of line.trips) {
      for (const layover of trip.layoverDetails) {
        if (layover.hotelName) keys.add(`${layover.city}|${layover.hotelName}`);
      }
    }
  }
  if (keys.size === 0) return {};

  const rawCounts = new Map<string, { food: number; gym: number; grocery: number }>();
  for (const key of keys) {
    const amenities = data[key]?.amenities;
    rawCounts.set(key, {
      // Coffee is folded into the walkable-food consideration rather than a sixth slider.
      food: (amenities?.food ?? 0) + (amenities?.coffee ?? 0),
      gym: amenities?.gym ?? 0,
      grocery: amenities?.grocery ?? 0,
    });
  }
  const allCounts = Array.from(rawCounts.values());
  const foodRange = [Math.min(...allCounts.map((c) => c.food)), Math.max(...allCounts.map((c) => c.food))] as const;
  const gymRange = [Math.min(...allCounts.map((c) => c.gym)), Math.max(...allCounts.map((c) => c.gym))] as const;
  const groceryRange = [
    Math.min(...allCounts.map((c) => c.grocery)),
    Math.max(...allCounts.map((c) => c.grocery)),
  ] as const;

  const result: Record<string, HotelSubscores> = {};
  for (const key of keys) {
    const counts = rawCounts.get(key)!;
    result[key] = {
      food: normalize(counts.food, foodRange[0], foodRange[1]),
      gym: gymScore(normalize(counts.gym, gymRange[0], gymRange[1]), data[key]?.reviewSummary ?? null),
      grocery: normalize(counts.grocery, groceryRange[0], groceryRange[1]),
      quiet: reviewThemeScore(data[key]?.reviewSummary ?? null, "quietness"),
      quality: reviewQualityScore(data[key]),
    };
  }
  return result;
}

/** Blends one hotel's sub-scores by how much the pilot weighted each aspect — categories with no signal at all (e.g. no reviews) are left out rather than treated as neutral. When nothing has been weighted, falls back to a plain average, purely so a value still exists to display. */
function computeHotelWeightedScore(sub: HotelSubscores, weights: PreferenceWeights): number {
  const parts: { value: number; weight: number }[] = [
    { value: sub.food, weight: Math.abs(weights.hotelFood) },
    { value: sub.gym, weight: Math.abs(weights.hotelGym) },
    { value: sub.grocery, weight: Math.abs(weights.hotelGrocery) },
  ];
  if (sub.quiet !== null) parts.push({ value: sub.quiet, weight: Math.abs(weights.hotelQuiet) });
  if (sub.quality !== null) parts.push({ value: sub.quality, weight: Math.abs(weights.hotelQuality) });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) {
    return parts.reduce((s, p) => s + p.value, 0) / parts.length;
  }
  return parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
}

/**
 * Averages the weighted layoverQuality score across a line's actual
 * assigned hotels — a layover with no hotel data at all (not yet looked up,
 * or lookup failed) is simply skipped rather than dragging the average
 * toward 0, since "unknown" isn't the same as "bad."
 */
function computeLayoverQualityScore(
  line: Line,
  weights: PreferenceWeights,
  hotelSubscores: Record<string, HotelSubscores>
): number {
  const scores = line.trips
    .flatMap((t) => t.layoverDetails)
    .filter((l) => l.hotelName)
    .map((l) => hotelSubscores[`${l.city}|${l.hotelName}`])
    .filter((s): s is HotelSubscores => !!s)
    .map((s) => computeHotelWeightedScore(s, weights));

  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/**
 * The same per-line averaging as `computeLayoverQualityScore`, but keeping
 * each of the five sub-aspects separate instead of blending them by weight —
 * lets a caller (the drag-to-swap learner) see which *specific* hotel aspect
 * two lines actually differ on, rather than only the single blended number.
 */
function computeLayoverQualityBreakdown(
  line: Line,
  hotelSubscores: Record<string, HotelSubscores>
): HotelSubscores | null {
  const scores = line.trips
    .flatMap((t) => t.layoverDetails)
    .filter((l) => l.hotelName)
    .map((l) => hotelSubscores[`${l.city}|${l.hotelName}`])
    .filter((s): s is HotelSubscores => !!s);

  if (scores.length === 0) return null;

  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const quietValues = scores.map((s) => s.quiet).filter((v): v is number => v !== null);
  const qualityValues = scores.map((s) => s.quality).filter((v): v is number => v !== null);

  return {
    food: avg(scores.map((s) => s.food)),
    gym: avg(scores.map((s) => s.gym)),
    grocery: avg(scores.map((s) => s.grocery)),
    quiet: quietValues.length > 0 ? avg(quietValues) : null,
    quality: qualityValues.length > 0 ? avg(qualityValues) : null,
  };
}

function normalize(value: number, min: number, max: number): number {
  if (max - min < 1e-9) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Weight -100..100 -> target 0..1 (0 = extreme low end, 1 = extreme high end, 0.5 = no preference). */
function weightToTarget(weight: number): number {
  return (weight + 100) / 200;
}

/**
 * A pilot who typed in an exact target (e.g. "16 days off") clearly cares
 * about that dimension even if they left the quick-round slider centered,
 * so an explicit target guarantees at least moderate importance. Commuting
 * does the same for reportTime, departures, and deadheadTolerance
 * specifically — an early/late report or an extra departure costs a
 * commuter a hotel night or a missed flight home, and a deadhead is a real,
 * higher-stakes call for them either way (it can save a commute or just be
 * dead time), whether or not they thought to weight it strongly themselves.
 * A commuter with no crash pad in domicile feels an extra departure even
 * more, so that combination raises departures' floor further still.
 *
 * `confidence` (0-1) scales the pilot-derived portion only — a preference
 * stated once, ambiguously, now counts less than one repeated with real
 * certainty (see `defaultConfidence`/`PreferenceFact.confidence`'s own doc
 * comment for what feeds this). The commuter-driven structural floors below
 * are the app's own judgment about a commuter's real, always-true costs, not
 * something the pilot needs to have confidently stated — they stay
 * unscaled, applied after confidence, so a low-confidence weight can still
 * never sink a commuter's reportTime/departures/deadhead importance below
 * what commuting itself already guarantees.
 */
function weightToImportance(
  key: WeightedDimensionKey,
  weight: number,
  hasExplicitTarget: boolean,
  isCommuter: boolean | null,
  hasCrashPad: boolean | null,
  confidence: number
): number {
  const base = Math.min(1, Math.abs(weight) / 100);
  let importance = (hasExplicitTarget ? Math.max(base, 0.5) : base) * confidence;
  if (isCommuter && (key === "reportTime" || key === "departures" || key === "deadheadTolerance")) {
    importance = Math.max(importance, 0.35);
  }
  if (isCommuter && hasCrashPad === false && key === "departures") {
    importance = Math.max(importance, 0.5);
  }
  return importance;
}

/**
 * The confidence to assume for a dimension the pilot has a real weight/
 * target on but that has no recorded `implicitConfidence` entry — a legacy
 * static-interview profile, or a key touched only via an explicit target
 * (which, per `finalizeAdaptiveProfile`, never records its own confidence).
 * Mirrors the exact default `rank-learning.ts`'s `collectCandidates` already
 * established (`weights[key] !== 0 ? 0.7 : 0.3`) — a deliberate answer is
 * trusted more than a total guess, kept consistent across both files rather
 * than inventing a second convention.
 */
function defaultConfidence(hasRealSignal: boolean): number {
  return hasRealSignal ? 0.7 : 0.3;
}

/** 1 - distance between value and target, so closer = higher score. */
function matchFromDistance(value: number, target: number): number {
  return 1 - Math.abs(value - target);
}

/** Today's bare number has always meant "ideal only" — normalizing here means `daysOff`/`departures`/`creditHours` can all be read through the same range-aware match logic below, with creditHours (which never receives min/max) degenerating exactly to today's single-point behavior. */
function asRangeTargetForScoring(value: number | RangeTarget | undefined): RangeTarget | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? { ideal: value } : value;
}

/**
 * A pinned single point (`matchFromDistance`) generalized to a tolerance
 * band: anywhere inside `[min, max]` is a full match, same as hitting the
 * ideal exactly used to be; outside it, distance-penalized from the nearer
 * bound exactly like the single-point case always was. With neither bound
 * set this is byte-for-byte `matchFromDistance(value, normalizedIdeal)`.
 */
function matchFromRange(
  value: number,
  normalizedIdeal: number,
  normalizedMin: number | undefined,
  normalizedMax: number | undefined
): number {
  if (normalizedMin === undefined && normalizedMax === undefined) {
    return matchFromDistance(value, normalizedIdeal);
  }
  // A stated floor with no ceiling (or vice versa) is open-ended on the
  // unstated side — "at least 20 days off" is a full match at 24, not a
  // point target collapsed onto 20 — so the unstated bound defaults to the
  // normalized extreme of this dimension's own bid-pack range, not back to
  // normalizedIdeal (which, with only one bound stated, is just that same
  // bound and would otherwise silently turn a floor/ceiling into a pinned
  // point).
  const lo = normalizedMin ?? 0;
  const hi = normalizedMax ?? 1;
  if (value >= lo && value <= hi) return 1;
  const distanceOutside = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - distanceOutside);
}

const FIXED_DIMENSION_KEYS = new Set<DimensionKey>([
  "daysOff", "tripLength", "international", "cityPreference", "reportTime",
  "creditHours", "deadheadTolerance", "departures", "layoverQuality", "circadianHealth", "landings",
]);

/** Distinguishes a fixed explicit dimension from an implicit-catalog id living in the same `DimensionScore.key` field — see that field's own doc comment. */
function isFixedDimensionKey(key: string): key is DimensionKey {
  return FIXED_DIMENSION_KEYS.has(key as DimensionKey);
}

const IMPLICIT_LABELS = new Map(IMPLICIT_VARIABLES.map((v) => [v.id, v.label] as const));

function weightFor(weights: PreferenceWeights, key: DimensionKey): number {
  return key === "cityPreference" || key === "layoverQuality" ? 0 : weights[key];
}

/**
 * Generic (not hand-authored per variable, unlike the fixed dimensions'
 * `hitPhrase`/`missPhrase` below) explanation phrasing for an implicit
 * dimension — there are 20+ of these and growing, so a bespoke phrase pair
 * per id isn't maintainable the way it is for the ten fixed dimensions.
 * Every `IMPLICIT_VARIABLES` label is written to read reasonably in this
 * template; a genuinely awkward one is a copy fix in `implicit-dimensions.ts`,
 * not a reason to hand-author more switch cases here.
 */
function implicitHitPhrase(label: string, weight: number): string {
  const l = label.toLowerCase();
  return weight > 0 ? `real strength on ${l}` : `staying refreshingly light on ${l}`;
}

function implicitMissPhrase(label: string, weight: number, below: boolean): string | null {
  const l = label.toLowerCase();
  if (weight > 0 && below) return `less ${l} than you'd probably like`;
  if (weight < 0 && !below) return `more ${l} than you'd probably want`;
  return null;
}

function hitPhrase(key: DimensionKey, weight: number): string {
  switch (key) {
    case "daysOff":
      return weight > 0 ? "plenty of days off" : "a compact, duty-heavy schedule";
    case "tripLength":
      return weight > 0 ? "long trips" : "short, quick trips";
    case "international":
      return weight > 0 ? "a strong international mix" : "mostly domestic flying";
    case "cityPreference":
      return "layovers in cities you flagged as favorites";
    case "reportTime":
      return weight > 0 ? "later report times" : "early report times";
    case "creditHours":
      return weight > 0 ? "high credit hours" : "a lean line";
    case "deadheadTolerance":
      return weight > 0 ? "deadhead legs mixed in, as expected" : "minimal deadheading";
    case "departures":
      return "close to the number of separate departures you asked for";
    case "layoverQuality":
      return "well-reviewed layover hotels near the things you said matter to you";
    case "circadianHealth":
      return "trips that stay easy on your sleep and body clock";
    case "landings":
      return weight > 0 ? "plenty of landings for proficiency and comfort" : "a lighter landing count for fatigue management";
  }
}

/**
 * Only surfaces a miss when it's the practically relevant direction (e.g. a
 * pilot who wants max credit and got a lean line, not the reverse, which
 * most pilots wouldn't experience as a complaint).
 */
function missPhrase(
  key: DimensionKey,
  weight: number,
  value: number,
  target: number
): string | null {
  const below = value < target;

  switch (key) {
    case "daysOff":
      if (weight > 0 && below) return "fewer days off than you'd like";
      if (weight < 0 && !below) return "more days off than a lean schedule";
      return null;
    case "tripLength":
      if (weight > 0 && below) return "shorter trips than you're after";
      if (weight < 0 && !below) return "longer trips than you'd probably like";
      return null;
    case "international":
      if (weight > 0 && below) return "less international flying than you're after";
      if (weight < 0 && !below) return "more international flying than you'd probably want";
      return null;
    case "cityPreference":
      return value < 0.35 ? "a layover or two in a city you flagged to avoid" : null;
    case "reportTime":
      if (weight > 0 && below) return "earlier report times than you'd like";
      if (weight < 0 && !below) return "later report times than you'd probably prefer";
      return null;
    case "creditHours":
      if (weight > 0 && below) return "fewer credit hours than you're after";
      if (weight < 0 && !below) return "more credit hours than a lean line";
      return null;
    case "deadheadTolerance":
      if (weight < 0 && !below) return "more deadheading than you'd prefer";
      return null;
    case "departures":
      return below ? "fewer departures than you pinned" : "more departures than you pinned";
    case "layoverQuality":
      return value < 0.35 ? "layover hotels that fall short on what you flagged as important" : null;
    case "circadianHealth":
      return value < 0.35 ? "trips that are rough on your sleep and body clock" : null;
    case "landings":
      if (weight > 0 && below) return "fewer landings than you're after";
      if (weight < 0 && !below) return "more landings than you'd probably want";
      return null;
  }
}

/** `hitPhrase`/`missPhrase` for a fixed dimension, `implicitHitPhrase`/`implicitMissPhrase` for anything else — see `DimensionScore.key`'s own doc comment for why both live in one array. */
function hitPhraseFor(d: DimensionScore, weights: PreferenceWeights, implicitWeights: Record<string, number>): string {
  if (isFixedDimensionKey(d.key)) return hitPhrase(d.key, weightFor(weights, d.key));
  return implicitHitPhrase(IMPLICIT_LABELS.get(d.key) ?? d.key, implicitWeights[d.key] ?? 0);
}

function missPhraseFor(d: DimensionScore, weights: PreferenceWeights, implicitWeights: Record<string, number>): string | null {
  if (isFixedDimensionKey(d.key)) return missPhrase(d.key, weightFor(weights, d.key), d.value, d.target);
  return implicitMissPhrase(IMPLICIT_LABELS.get(d.key) ?? d.key, implicitWeights[d.key] ?? 0, d.value < d.target);
}

function explain(topDimensions: DimensionScore[], weights: PreferenceWeights, implicitWeights: Record<string, number>): string {
  const meaningful = topDimensions.filter((d) => d.importance > 0.05);
  if (meaningful.length === 0) {
    return "Scored on overall balance since no strong preferences were set.";
  }

  // Never cite an unverified (estimated) dimension as a reason this line
  // won or lost — an estimate isn't a fact worth building an explanation
  // on, even though it still contributes to the overall score.
  const verifiable = meaningful.filter((d) => d.verified);
  const hasUnverifiedTopDimension = meaningful.some((d) => !d.verified);

  const goodPhrases = verifiable
    .filter((d) => d.match > 0.6)
    .slice(0, 2)
    .map((d) => hitPhraseFor(d, weights, implicitWeights));

  const missDimension = [...verifiable]
    .filter((d) => d.match <= 0.5)
    .sort((a, b) => b.importance - a.importance)
    .map((d) => ({
      d,
      phrase: missPhraseFor(d, weights, implicitWeights),
    }))
    .find((entry) => entry.phrase !== null);

  let base = "";
  if (goodPhrases.length > 0 && missDimension) {
    base = `Stands out for ${goodPhrases.join(" and ")}, though it has ${missDimension.phrase}.`;
  } else if (goodPhrases.length > 0) {
    base = `Stands out for ${goodPhrases.join(" and ")}.`;
  } else if (missDimension) {
    base = `Ranks lower mainly because it has ${missDimension.phrase}.`;
  } else if (!hasUnverifiedTopDimension) {
    base = "A middle-of-the-pack match across the things you weighted.";
  }

  if (hasUnverifiedTopDimension) {
    const caveat =
      "This line's trip shape couldn't be confirmed from the bid pack, so part of this score is an estimate.";
    return base ? `${base} ${caveat}` : caveat;
  }

  return base;
}

/** A single named, specific reason a line's Satisfaction Index went up or down — reuses the exact same hand-authored/generic phrase generators `explain()` draws from, just surfaced as a richer list instead of folded into one sentence. */
export interface SatisfactionFactor {
  label: string;
  matchPercent: number;
}

/**
 * The expanded "why" breakdown — more than `explain()`'s own 1-2-item cap,
 * for a dedicated results-screen section rather than the short collapsed-
 * card sentence. Ranked by actual contribution strength (importance *
 * match for a contributor, importance alone for a detractor, since a low
 * match is the point there) rather than importance alone, so the list leads
 * with what's genuinely moving the number the most.
 */
function topContributorsAndDetractors(
  allDimensions: DimensionScore[],
  weights: PreferenceWeights,
  implicitWeights: Record<string, number>,
  limit = 3
): { contributors: SatisfactionFactor[]; detractors: SatisfactionFactor[] } {
  const verifiable = allDimensions.filter((d) => d.verified && d.importance > 0.05);

  const contributors = [...verifiable]
    .filter((d) => d.match > 0.6)
    .sort((a, b) => b.importance * b.match - a.importance * a.match)
    .slice(0, limit)
    .map((d) => ({ label: hitPhraseFor(d, weights, implicitWeights), matchPercent: Math.round(d.match * 100) }));

  const detractors = [...verifiable]
    .filter((d) => d.match <= 0.5)
    .map((d) => ({ d, phrase: missPhraseFor(d, weights, implicitWeights) }))
    .filter((x): x is { d: DimensionScore; phrase: string } => x.phrase !== null)
    .sort((a, b) => b.d.importance - a.d.importance)
    .slice(0, limit)
    .map((x) => ({ label: x.phrase, matchPercent: Math.round(x.d.match * 100) }));

  return { contributors, detractors };
}

/**
 * The single dimension with the most real leverage over this line's current
 * score right now — not just "what's currently good or bad" (that's
 * `contributors`/`detractors`), but which one, if it shifted even slightly,
 * would move the total the most. Since the overall score is an
 * importance-weighted average, a dimension's marginal effect on it is
 * proportional to its own importance share — so this is just "highest
 * importance among dimensions with real room left to improve" (a maxed-out
 * `match` of 1 has zero marginal room no matter how important). Verified
 * dimensions only — an estimated line's guessed dimensions shouldn't be
 * presented as where the real risk/opportunity is.
 */
export function mostLeveragedDimension(lineScore: { dimensions: DimensionScore[] }): DimensionScore | null {
  const candidates = lineScore.dimensions.filter((d) => d.verified && d.importance > 0.05 && d.match < 0.999);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, d) => (d.importance > best.importance ? d : best));
}

/** Fixed dimensions with a real, continuous, denormalizable unit a pilot would recognize — a numeric counterfactual can honestly cite a real number for these. `reportTime`/`international`/`deadheadTolerance` are share- or bucket-shaped in this app's own raw-metric computation (see `computeRawMetrics`), not a clean continuous scalar ("3.2 hours later" or "62% international" isn't something this data actually measures) — those get a qualitative, direction-only fallback instead of a fabricated precise number. */
const NUMERIC_COUNTERFACTUAL_UNITS: Partial<Record<DimensionKey, { unit: string; unitPlural: string; decimals: number }>> = {
  daysOff: { unit: "day off", unitPlural: "days off", decimals: 0 },
  creditHours: { unit: "hour of credit", unitPlural: "hours of credit", decimals: 1 },
  departures: { unit: "departure", unitPlural: "departures", decimals: 0 },
  landings: { unit: "landing", unitPlural: "landings", decimals: 0 },
  tripLength: { unit: "day of trip length", unitPlural: "days of trip length", decimals: 1 },
};

export interface CounterfactualRanges {
  daysOff: readonly [number, number];
  avgTripLength: readonly [number, number];
  creditHours: readonly [number, number];
  departures: readonly [number, number];
  landings: readonly [number, number];
}

function boundsForCounterfactual(key: DimensionKey, ranges: CounterfactualRanges): readonly [number, number] | undefined {
  switch (key) {
    case "daysOff":
      return ranges.daysOff;
    case "tripLength":
      return ranges.avgTripLength;
    case "creditHours":
      return ranges.creditHours;
    case "departures":
      return ranges.departures;
    case "landings":
      return ranges.landings;
    default:
      return undefined;
  }
}

function counterfactualPhraseForDimension(dim: DimensionScore, neededMatch: number, ranges: CounterfactualRanges): string {
  if (isFixedDimensionKey(dim.key)) {
    const spec = NUMERIC_COUNTERFACTUAL_UNITS[dim.key];
    const bounds = boundsForCounterfactual(dim.key, ranges);
    if (spec && bounds) {
      const span = bounds[1] - bounds[0];
      if (span > 1e-9) {
        // Move value toward target by exactly the match improvement needed — matchFromDistance is symmetric, so this is the only direction that actually raises match.
        const direction = dim.target >= dim.value ? 1 : -1;
        const neededNormalizedValue = Math.min(1, Math.max(0, dim.value + direction * (neededMatch - dim.match)));
        const rawNeeded = bounds[0] + neededNormalizedValue * span;
        const rawCurrent = bounds[0] + dim.value * span;
        const delta = rawNeeded - rawCurrent;
        const rounded = Math.round(Math.abs(delta) * 10 ** spec.decimals) / 10 ** spec.decimals;
        if (rounded > 0) {
          const unit = rounded === 1 ? spec.unit : spec.unitPlural;
          return `about ${rounded} ${delta > 0 ? "more" : "fewer"} ${unit}`;
        }
      }
    }
  }
  const label = isFixedDimensionKey(dim.key) ? humanizeKey(dim.key) : (IMPLICIT_LABELS.get(dim.key) ?? dim.key);
  return `a meaningfully better ${label.toLowerCase()}`;
}

/** Only worth stating when a single dimension's own real ceiling (match capped at 1) could plausibly close the gap — otherwise the claim "this one change would make it your top pick" would be false, since no single realistic change actually would. */
const MAX_CLOSEABLE_MATCH_OVERSHOOT = 1.05;

/**
 * "What would need to change" — for a line that isn't the top pick, the
 * smallest realistic single-dimension change that would likely close the
 * gap to it. Grounded in the same importance-weighted-average math the
 * overall score already uses: moving one dimension's match by Δm changes
 * the total score by `Δm * importance_i / totalImportance * 100`, so the Δm
 * needed to close a known score gap is solvable directly — no simulation,
 * no re-running the scorer.
 */
export function computeCounterfactual(
  lineScore: { score: number; dimensions: DimensionScore[] },
  topScore: number,
  ranges: CounterfactualRanges
): string | null {
  if (topScore - lineScore.score < 0.5) return null;
  const candidate = mostLeveragedDimension(lineScore);
  if (!candidate) return null;

  const totalImportance = lineScore.dimensions.reduce((s, d) => s + Math.max(d.importance, 0.05), 0);
  const w = Math.max(candidate.importance, 0.05);
  const neededMatchDelta = ((topScore - lineScore.score) / 100) * (totalImportance / w);
  const neededMatch = candidate.match + neededMatchDelta;
  if (neededMatch > MAX_CLOSEABLE_MATCH_OVERSHOOT) return null; // no single realistic change on this dimension would actually close the gap
  if (neededMatch - candidate.match < 0.02) return null; // negligible — not worth stating

  const phrase = counterfactualPhraseForDimension(candidate, Math.min(1, neededMatch), ranges);
  return `If this line had ${phrase}, it would likely be your top pick.`;
}

/** Every dimension partitioned by `categoryFor`, scored via the exact same weighted-average formula `scoreBidPack` uses for the overall index — so a pilot can trust the categories genuinely explain the overall number, not run through a separate parallel calculation. Every category is guaranteed at least one fixed dimension (see `satisfaction-categories.ts`'s mapping), so this never divides by zero. */
function computeCategoryScores(allDimensions: DimensionScore[]): Record<SatisfactionCategory, { score: number; label: string }> {
  const result = {} as Record<SatisfactionCategory, { score: number; label: string }>;
  for (const category of SATISFACTION_CATEGORIES) {
    const dims = allDimensions.filter((d) => categoryFor(d.key) === category);
    const totalImportance = dims.reduce((s, d) => s + Math.max(d.importance, 0.05), 0);
    const weightedMatch = dims.reduce((s, d) => s + d.match * Math.max(d.importance, 0.05), 0);
    const score = totalImportance > 0 ? (weightedMatch / totalImportance) * 100 : 50;
    result[category] = { score: Math.round(score * 10) / 10, label: SATISFACTION_CATEGORY_LABELS[category] };
  }
  return result;
}

/** How far below "clearly fine" a match has to fall before a dealbreaker counts as violated — deliberately well below the ordinary 0.5 miss-phrase threshold, since a dealbreaker should only fire on a line that's unambiguously on the wrong side, not one that merely misses the pilot's target by a little. */
const DEALBREAKER_MATCH_THRESHOLD = 0.25;
/** A violating line is capped, not zeroed — it should still read as a real, rankable line ("flagged," per the spec's own "still surface if nothing better exists" requirement), not look like a broken/empty score. */
const DEALBREAKER_SCORE_CAP = 35;

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

const IMPLICIT_LABELS_FOR_DEALBREAKERS = new Map(IMPLICIT_VARIABLES.map((v) => [v.id, v.label] as const));

/** A single dealbreaker the line actually violates, ready to surface prominently — never silently folded into the continuous average. */
export interface DealbreakerViolation {
  statement: string;
  label: string;
}

/** A stated dealbreaker this line does not violate, but comes close enough to that it's worth flagging as real risk before it becomes a violation. */
export interface DealbreakerNearMiss {
  statement: string;
  label: string;
}

/** How far above the violation threshold a match still counts as "close enough to flag" — deliberately narrow, so this only catches genuine near-misses, not every line that merely isn't great on that dimension. */
const NEAR_MISS_MATCH_BAND = 0.15;
/** How close (in real units — days off, or departures) a line can sit to a stated floor/ceiling and still count as a near-miss. */
const NEAR_MISS_RANGE_UNITS = 2;

/**
 * The near-miss counterpart to `dealbreakerViolatedFor` — only ever called
 * for a fact `dealbreakerViolatedFor` did NOT already flag as violated (see
 * `scoreBidPack`'s wiring), so these two lists are mutually exclusive by
 * construction, never by an extra check here. Deliberately narrower than
 * `dealbreakerViolatedFor`: `city-sentiment`, `international`,
 * `deadheadTolerance`, and `redEyeDeparturesPerTrip` are binary per-trip
 * presence checks with no honest continuous "how close" to compute (a trip
 * either touches the flagged city or it doesn't) — only the fixed
 * explicit-target range keys and ordinary match-based bindings have a real
 * distance to report.
 */
function dealbreakerNearMissFor(
  fact: PreferenceFact & { measurable: MeasurableBinding },
  line: Line,
  values: Record<DimensionKey, number>,
  implicitValues: Record<string, number> | undefined
): DealbreakerNearMiss | null {
  const binding = fact.measurable;

  if (binding.type === "explicit-target") {
    if (binding.rangeRole !== "min" && binding.rangeRole !== "max") return null;
    const rawValue = binding.key === "daysOff" ? line.daysOff : binding.key === "departures" ? line.totalDepartures : undefined;
    if (rawValue === undefined) return null;
    const distance = binding.rangeRole === "min" ? rawValue - binding.value : binding.value - rawValue;
    if (distance > 0 && distance <= NEAR_MISS_RANGE_UNITS) {
      return { statement: fact.statement, label: humanizeKey(binding.key) };
    }
    return null;
  }

  if (binding.type === "explicit-weight" && binding.key !== "international" && binding.key !== "deadheadTolerance") {
    const value = values[binding.key as DimensionKey];
    if (value === undefined) return null;
    const target = binding.direction > 0 ? 1 : 0;
    const match = matchFromDistance(value, target);
    if (match >= DEALBREAKER_MATCH_THRESHOLD && match < DEALBREAKER_MATCH_THRESHOLD + NEAR_MISS_MATCH_BAND) {
      return { statement: fact.statement, label: humanizeKey(binding.key) };
    }
    return null;
  }

  if (binding.type === "implicit-weight" && binding.variableId !== "redEyeDeparturesPerTrip") {
    const value = implicitValues?.[binding.variableId];
    if (value === undefined) return null;
    const target = binding.direction > 0 ? 1 : 0;
    const match = matchFromDistance(value, target);
    if (match >= DEALBREAKER_MATCH_THRESHOLD && match < DEALBREAKER_MATCH_THRESHOLD + NEAR_MISS_MATCH_BAND) {
      return {
        statement: fact.statement,
        label: IMPLICIT_LABELS_FOR_DEALBREAKERS.get(binding.variableId) ?? humanizeKey(binding.variableId),
      };
    }
    return null;
  }

  return null;
}

/**
 * Checked directly against the line's own raw normalized values/city list —
 * independent of whether that dimension happened to clear the *scoring*
 * inclusion gates (e.g. an implicit dimension below `MIN_CONFIDENCE_FOR_
 * IMPLICIT_SCORING`) — a stated dealbreaker should always be checked, even
 * in the rare case its confidence wasn't quite enough to move the
 * continuous score on its own.
 */
function dealbreakerViolatedFor(
  fact: PreferenceFact & { measurable: MeasurableBinding },
  line: Line,
  values: Record<DimensionKey, number>,
  implicitValues: Record<string, number> | undefined
): DealbreakerViolation | null {
  const binding = fact.measurable;

  if (binding.type === "city-sentiment") {
    if (binding.sentiment !== "avoid") return null;
    const violated = line.trips.some((t) => t.layoverCities.includes(binding.code));
    return violated ? { statement: fact.statement, label: binding.code } : null;
  }

  if (binding.type === "explicit-weight") {
    // "international" and "deadheadTolerance" are per-trip presence
    // concepts averaged into a line-level share/count for ordinary scoring
    // — exactly the dilution this whole rewrite otherwise exists to avoid.
    // A pilot who says "I will not accept ANY international flying" means
    // literally any trip, not "the line's average share is clearly bad": a
    // two-trip line that's half domestic would average to match=0.5, well
    // above the ordinary violation threshold, and silently slip through.
    // Checked directly against real per-trip data for these two keys
    // instead of the averaged dimension value.
    if (binding.key === "international") {
      const anyInternational = line.trips.some((t) => t.international);
      const violated = binding.direction < 0 ? anyInternational : !anyInternational;
      return violated ? { statement: fact.statement, label: "International" } : null;
    }
    if (binding.key === "deadheadTolerance") {
      const anyDeadhead = line.trips.some((t) => t.deadheadLegs > 0);
      const violated = binding.direction < 0 ? anyDeadhead : !anyDeadhead;
      return violated ? { statement: fact.statement, label: "Deadhead legs" } : null;
    }
    const value = values[binding.key as DimensionKey];
    if (value === undefined) return null;
    const target = binding.direction > 0 ? 1 : 0;
    const violated = matchFromDistance(value, target) < DEALBREAKER_MATCH_THRESHOLD;
    return violated ? { statement: fact.statement, label: humanizeKey(binding.key) } : null;
  }

  if (binding.type === "implicit-weight") {
    // Same per-trip-average dilution risk applies to most of the implicit
    // catalog too — many ids are literally named "...PerTrip". Fixed for
    // "redEyeDeparturesPerTrip" specifically (the single most common
    // real-world dealbreaker — confirmed live in Phase 4 validation, where a
    // persona's genuine "I will not accept a red-eye, full stop" correctly
    // got flagged by the model on exactly this id) by reusing the same
    // per-trip `hasRedEyeLeg` primitive `line-filters.ts` already relies on.
    // The remaining threshold-shaped implicit ids (back-of-clock departures,
    // short-rest overnights, etc.) still use the averaged value below — a
    // full fix needs raw, pre-normalization per-trip values threaded through
    // from implicit-dimensions.ts, which this layer doesn't have access to
    // today. Known, real limitation: an implicit-weight dealbreaker on one
    // of those remaining ids can under-trigger on a multi-trip line where
    // only one trip exhibits the violating pattern.
    if (binding.variableId === "redEyeDeparturesPerTrip") {
      const anyRedEye = line.trips.some(hasRedEyeLeg);
      const violated = binding.direction < 0 ? anyRedEye : !anyRedEye;
      return violated ? { statement: fact.statement, label: "Red-eye departures" } : null;
    }
    const value = implicitValues?.[binding.variableId];
    if (value === undefined) return null;
    const target = binding.direction > 0 ? 1 : 0;
    const violated = matchFromDistance(value, target) < DEALBREAKER_MATCH_THRESHOLD;
    return violated
      ? { statement: fact.statement, label: IMPLICIT_LABELS_FOR_DEALBREAKERS.get(binding.variableId) ?? humanizeKey(binding.variableId) }
      : null;
  }

  if (binding.type === "explicit-target") {
    // Only "min"/"max" ever carry severity (parseProfileUpdates drops it
    // otherwise) — a stated floor or ceiling on daysOff/departures, checked
    // against the line's own real raw total, no normalization needed.
    if (binding.rangeRole !== "min" && binding.rangeRole !== "max") return null;
    const rawValue = binding.key === "daysOff" ? line.daysOff : binding.key === "departures" ? line.totalDepartures : undefined;
    if (rawValue === undefined) return null; // creditHours never receives a rangeRole, so never reaches here in practice.
    const violated = binding.rangeRole === "min" ? rawValue < binding.value : rawValue > binding.value;
    return violated ? { statement: fact.statement, label: humanizeKey(binding.key) } : null;
  }

  return null;
}

/**
 * Real, cheap context tying a qualitative fact back to THIS specific line's
 * actual data — not an AI-authored narrative sentence per line (see the
 * plan's Flag F4: an LLM call per line on every drag-and-drop re-rank isn't
 * viable for an interactive results page). A fact surfaces here only when
 * the line's own data concretely confirms its relevance: it names a city
 * this line actually touches, or — for the one keyword this function knows
 * how to check cheaply — mentions a red-eye and this line actually has one.
 */
function qualitativeTieInsForLine(qualitativeFacts: PreferenceFact[], line: Line, limit = 3): string[] {
  if (qualitativeFacts.length === 0) return [];
  const lineCities = new Set(line.trips.flatMap((t) => t.layoverCities).map((c) => c.toLowerCase()));
  const lineHasRedEye = line.trips.some(hasRedEyeLeg);

  const matches = qualitativeFacts.filter((f) => {
    const text = f.statement.toLowerCase();
    if ([...lineCities].some((c) => text.includes(c))) return true;
    if (lineHasRedEye && /red-eye|red eye/.test(text)) return true;
    return false;
  });

  return matches.slice(0, limit).map((f) => f.statement);
}

/** Real, on-file review text tied back to a pilot's own stated hotel-related reason for loving/avoiding a city — see `PreferenceFact.cityReason`. */
export interface HotelReviewTieIn {
  cityCode: string;
  hotelName: string;
  summary: string;
}

/**
 * Connects two features that otherwise sit next to each other without
 * talking: the interview's own "why did you flag this city" follow-up, and
 * the hotel review data already fetched for `layoverQuality` scoring. Only
 * ever surfaces something when BOTH are real and already on file — a
 * pilot's hotel-related reason for a city this line actually touches, AND a
 * real review summary already looked up for the hotel assigned there. Never
 * fabricates either side.
 */
function hotelReviewTieInForLine(
  line: Line,
  qualitativeFacts: PreferenceFact[],
  hotelQualityData: HotelQualityData
): HotelReviewTieIn | null {
  const hotelReasons = qualitativeFacts.filter((f) => f.cityReason?.category === "hotel");
  if (hotelReasons.length === 0) return null;

  for (const layover of line.trips.flatMap((t) => t.layoverDetails)) {
    if (!layover.hotelName) continue;
    const reason = hotelReasons.find((f) => f.cityReason!.code === layover.city);
    if (!reason) continue;
    const entry = hotelQualityData[`${layover.city}|${layover.hotelName}`];
    if (entry?.reviewSummary) {
      return { cityCode: layover.city, hotelName: layover.hotelName, summary: entry.reviewSummary.summary };
    }
  }
  return null;
}

/** How similar (1 - mean absolute distance across shared dimension keys) a line has to be to a pilot's best-remembered prior-cycle favorite before it's worth mentioning — high enough that this only fires on a genuine resemblance, not "shares a couple of traits." */
const HISTORICAL_SIMILARITY_THRESHOLD = 0.85;

/**
 * "This scores similarly to lines you've historically preferred" — compares
 * this line's own normalized dimension values against whichever of the
 * pilot's prior-cycle top lines (see `line-history-storage.ts`) it's closest
 * to, on whatever dimension keys both happen to share (a dimension that only
 * exists on one side, e.g. an implicit id this cycle's profile never
 * touched, is simply skipped rather than counted as a mismatch). Returns
 * null — never a fabricated comparison — when there's no snapshot at all, or
 * nothing in it is genuinely close.
 */
export function historicalConsistencyNote(
  lineScore: { dimensions: DimensionScore[] },
  priorTopLines: LineSnapshot[] | null | undefined
): string | null {
  if (!priorTopLines || priorTopLines.length === 0) return null;
  const currentValues = new Map(lineScore.dimensions.map((d) => [String(d.key), d.value]));

  let bestSimilarity = 0;
  for (const prior of priorTopLines) {
    const sharedKeys = Object.keys(prior.dimensionValues).filter((k) => currentValues.has(k));
    if (sharedKeys.length === 0) continue;
    const meanDistance =
      sharedKeys.reduce((s, k) => s + Math.abs(currentValues.get(k)! - prior.dimensionValues[k]), 0) / sharedKeys.length;
    bestSimilarity = Math.max(bestSimilarity, 1 - meanDistance);
  }

  return bestSimilarity >= HISTORICAL_SIMILARITY_THRESHOLD
    ? "This scores similarly to lines you've historically preferred."
    : null;
}

export interface BidPackRanges {
  daysOff: readonly [number, number];
  creditHours: readonly [number, number];
  departures: readonly [number, number];
}

/**
 * Real min/max span of daysOff, creditHours, and departures across a bid
 * pack's lines, used to bound "type in your ideal number" inputs in actual
 * units instead of an abstract -100..100 scale.
 */
export function getBidPackRanges(bidPack: BidPack): BidPackRanges {
  const daysOffValues = bidPack.lines.map((l) => l.daysOff);
  const creditValues = bidPack.lines.map((l) => l.totalCreditHours);
  const departuresValues = bidPack.lines.map((l) => l.totalDepartures);
  return {
    daysOff: [Math.min(...daysOffValues), Math.max(...daysOffValues)],
    creditHours: [Math.min(...creditValues), Math.max(...creditValues)],
    departures: [Math.min(...departuresValues), Math.max(...departuresValues)],
  };
}

/** Every distinct layover city in this bid pack, most-visited first — the pool the city-preference picker draws from. */
export function rankLayoverCitiesByFrequency(bidPack: BidPack): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const trip of bidPack.lines.flatMap((l) => l.trips)) {
    for (const city of trip.layoverCities) {
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

export function scoreBidPack(
  bidPack: BidPack,
  profile: PreferenceProfile,
  hotelQualityData: HotelQualityData = {},
  implicitValuesByLine: Record<string, Record<string, number>> = {},
  /** Computed by the caller via `assessProfileRichness` (`interview-engine.ts`) — kept out of this module to avoid a real circular dependency (see the type-only import comment at the top of this file). Absent means every `LineScore.confidenceLevel` comes back `null`, not defaulted to "thorough" — a caller that hasn't wired this up yet sees no behavior change, not a false claim of high confidence. */
  profileRichness?: ProfileRichness,
  /** This pilot's remembered prior-cycle top lines (see `line-history-storage.ts`), if any — absent or empty means every `LineScore.historicalNote` comes back null, never a fabricated comparison. */
  priorTopLines?: LineSnapshot[] | null
): LineScore[] {
  const {
    weights,
    explicitTargets,
    cityPreferences,
    isCommuter,
    hasCrashPad,
    implicitWeights,
    implicitConfidence,
    discoveredFacts,
  } = profile;
  const dealbreakerFacts = (discoveredFacts ?? []).filter(
    (f): f is PreferenceFact & { measurable: MeasurableBinding } => f.severity === "dealbreaker" && f.kind === "measurable" && !!f.measurable
  );
  const qualitativeFacts = (discoveredFacts ?? []).filter((f) => f.kind === "qualitative");

  // A pilot who told the interview a city's hotel was specifically why they
  // loved/avoided it (`cityReason.category === "hotel"`) has given real
  // signal that hotel quality matters to them — even if they never
  // separately answered a generic hotelQuality slider, which would
  // otherwise leave `weights.hotelQuality` at 0 and silently zero out
  // `layoverQuality`'s importance no matter how high its confidence reads
  // (importance is `magnitude * confidence` — a 0 magnitude stays 0
  // regardless). `effectiveWeights`/`effectiveImplicitConfidence` are used
  // ONLY for the `layoverQuality` dimension below (both its value-blending
  // via `computeLayoverQualityScore` and its own importance calculation) —
  // never for any other dimension, and never overwriting a real weight the
  // pilot actually set themselves.
  const hasHotelReasonFact = qualitativeFacts.some((f) => f.cityReason?.category === "hotel");
  const HOTEL_REASON_IMPLIED_WEIGHT = 60;
  const effectiveWeights: PreferenceWeights =
    hasHotelReasonFact && weights.hotelQuality === 0
      ? { ...weights, hotelQuality: HOTEL_REASON_IMPLIED_WEIGHT }
      : weights;
  const effectiveImplicitConfidence: Record<string, number> = hasHotelReasonFact
    ? { ...implicitConfidence, hotelQuality: Math.max(implicitConfidence.hotelQuality ?? 0, 0.7) }
    : implicitConfidence;

  const rawMetrics = bidPack.lines.map(computeRawMetrics);
  const cityScores = bidPack.lines.map((l) => computeCityScore(l, cityPreferences));
  const hotelSubscores = computeHotelSubscores(bidPack, hotelQualityData);
  const layoverQualityScores = bidPack.lines.map((l) =>
    computeLayoverQualityScore(l, effectiveWeights, hotelSubscores)
  );
  const homeBaseOffsetMinutes = computeHomeBaseOffsetMinutes(bidPack);
  // A bare number is the only shape this key is ever meant to have (see
  // `ExplicitTargetKey`'s own doc comment on why it's the odd one out) — a
  // stray RangeTarget here (which should never happen) is treated the same
  // as absent rather than guessed at.
  const rawCircadianTolerance = explicitTargets.circadianTolerance;
  const circadianTolerance = typeof rawCircadianTolerance === "number" ? rawCircadianTolerance : null;
  const circadianScores = bidPack.lines.map((l) => computeCircadianHealthScore(l, homeBaseOffsetMinutes, circadianTolerance));
  const cumulativeCircadianByLine = bidPack.lines.map((l) =>
    computeCumulativeCircadianAssessment(l.trips, homeBaseOffsetMinutes, bidPack.bidPeriodStart, circadianTolerance)
  );
  const bidPackRanges = getBidPackRanges(bidPack);

  const ranges = {
    daysOff: bidPackRanges.daysOff,
    avgTripLength: [
      Math.min(...rawMetrics.map((m) => m.avgTripLength)),
      Math.max(...rawMetrics.map((m) => m.avgTripLength)),
    ] as const,
    creditHours: bidPackRanges.creditHours,
    deadheadPerTrip: [
      Math.min(...rawMetrics.map((m) => m.deadheadPerTrip)),
      Math.max(...rawMetrics.map((m) => m.deadheadPerTrip)),
    ] as const,
    cityScore: [Math.min(...cityScores), Math.max(...cityScores)] as const,
    layoverQuality: [Math.min(...layoverQualityScores), Math.max(...layoverQualityScores)] as const,
    departures: bidPackRanges.departures,
    landings: [
      Math.min(...rawMetrics.map((m) => m.totalLandings)),
      Math.max(...rawMetrics.map((m) => m.totalLandings)),
    ] as const,
  };

  const results = bidPack.lines.map((line, i) => {
    const raw = rawMetrics[i];

    const values: Record<DimensionKey, number> = {
      daysOff: normalize(raw.daysOff, ranges.daysOff[0], ranges.daysOff[1]),
      tripLength: normalize(
        raw.avgTripLength,
        ranges.avgTripLength[0],
        ranges.avgTripLength[1]
      ),
      international: raw.internationalShare,
      cityPreference: normalize(cityScores[i], ranges.cityScore[0], ranges.cityScore[1]),
      reportTime: raw.reportLean,
      creditHours: normalize(
        raw.creditHours,
        ranges.creditHours[0],
        ranges.creditHours[1]
      ),
      // Higher normalized value = more deadheading = matches a pilot who
      // said deadheading "doesn't matter" (+100).
      deadheadTolerance: normalize(
        raw.deadheadPerTrip,
        ranges.deadheadPerTrip[0],
        ranges.deadheadPerTrip[1]
      ),
      layoverQuality: normalize(layoverQualityScores[i], ranges.layoverQuality[0], ranges.layoverQuality[1]),
      departures: normalize(raw.totalDepartures, ranges.departures[0], ranges.departures[1]),
      // Neutral fallback when no trip in the line has a real assessment —
      // the `verified` flag below (via circadianScores[i] === null) is what
      // actually tells the caller "no real data," not this placeholder.
      circadianHealth: circadianScores[i] ?? 0.5,
      landings: normalize(raw.totalLandings, ranges.landings[0], ranges.landings[1]),
    };

    const dimensions: DimensionScore[] = (
      Object.keys(values) as DimensionKey[]
    ).map((key) => {
      if (key === "cityPreference") {
        const hasCityPrefs = Object.keys(cityPreferences).length > 0;
        const importance = hasCityPrefs ? 0.55 : 0;
        return {
          key,
          value: values[key],
          target: 1,
          importance,
          match: matchFromDistance(values[key], 1),
          verified: !(line.estimated && UNVERIFIED_WHEN_ESTIMATED.includes(key)),
        };
      }

      if (key === "layoverQuality") {
        // One-directional, like cityPreference: "better layover hotels"
        // always matches, there's no bipolar target to derive from a
        // slider's sign. Five separate sliders feed this one dimension
        // (food, gym, grocery, quiet, overall quality), so its importance is
        // driven by whichever of them the pilot weighted most strongly —
        // caring a lot about even one aspect should give the dimension real
        // weight in the total score.
        const hotelWeightKeys = ["hotelFood", "hotelGym", "hotelGrocery", "hotelQuiet", "hotelQuality"] as const;
        const dominantHotelKey = hotelWeightKeys.reduce((best, k) =>
          Math.abs(effectiveWeights[k]) > Math.abs(effectiveWeights[best]) ? k : best
        );
        const maxHotelWeight = Math.abs(effectiveWeights[dominantHotelKey]);
        // Confidence of whichever hotel aspect is actually driving this
        // dimension's importance — "caring a lot about even one aspect"
        // should be scaled by how sure the extraction was about that one
        // aspect, not an unrelated hotel slider's own confidence.
        const hotelConfidence =
          effectiveImplicitConfidence[dominantHotelKey] ?? defaultConfidence(effectiveWeights[dominantHotelKey] !== 0);
        const importance = Math.min(1, maxHotelWeight / 100) * hotelConfidence;
        return {
          key,
          value: values[key],
          target: 1,
          importance,
          match: matchFromDistance(values[key], 1),
          verified: !(line.estimated && UNVERIFIED_WHEN_ESTIMATED.includes(key)),
          hotelBreakdown: computeLayoverQualityBreakdown(line, hotelSubscores),
        };
      }

      if (key === "circadianHealth") {
        // One-directional, like cityPreference/layoverQuality: "less
        // circadian disruption" always matches, there's no bipolar slider
        // to derive a target from — only the *magnitude* of the pilot's
        // circadianHealth weight drives importance, same as the hotel
        // dimensions. Zero importance when the line has no real trip data
        // to score it from, regardless of how strongly the pilot weighted
        // it — an unverified guess shouldn't silently move anyone's ranking.
        const hasRealData = circadianScores[i] !== null;
        const circadianConfidence =
          implicitConfidence.circadianHealth ?? defaultConfidence(weights.circadianHealth !== 0);
        const importance = hasRealData ? Math.min(1, Math.abs(weights.circadianHealth) / 100) * circadianConfidence : 0;
        return {
          key,
          value: values[key],
          target: 1,
          importance,
          match: matchFromDistance(values[key], 1),
          verified: hasRealData,
        };
      }

      let target: number;
      let match: number;
      let hasExplicitTarget = false;

      if ((key === "daysOff" || key === "creditHours" || key === "departures") && explicitTargets[key] !== undefined) {
        hasExplicitTarget = true;
        const bounds = key === "daysOff" ? ranges.daysOff : key === "creditHours" ? ranges.creditHours : ranges.departures;
        // Only daysOff/departures ever actually carry min/max (creditHours
        // never receives range treatment — see RangeTarget's own doc
        // comment) — asRangeTargetForScoring/matchFromRange handle both
        // uniformly, with creditHours' bare number degenerating to exactly
        // today's single-point behavior.
        const range = asRangeTargetForScoring(explicitTargets[key])!;
        const normalizedIdeal =
          range.ideal !== undefined
            ? normalize(range.ideal, bounds[0], bounds[1])
            : range.min !== undefined && range.max !== undefined
              ? normalize((range.min + range.max) / 2, bounds[0], bounds[1])
              : range.min !== undefined
                ? normalize(range.min, bounds[0], bounds[1])
                : range.max !== undefined
                  ? normalize(range.max, bounds[0], bounds[1])
                  : 0.5;
        const normalizedMin = range.min !== undefined ? normalize(range.min, bounds[0], bounds[1]) : undefined;
        const normalizedMax = range.max !== undefined ? normalize(range.max, bounds[0], bounds[1]) : undefined;
        target = normalizedIdeal;
        match = matchFromRange(values[key], normalizedIdeal, normalizedMin, normalizedMax);
      } else {
        target = weightToTarget(weights[key]);
        match = matchFromDistance(values[key], target);
      }

      const confidence = implicitConfidence[key] ?? defaultConfidence(weights[key] !== 0 || hasExplicitTarget);
      const importance = weightToImportance(key, weights[key], hasExplicitTarget, isCommuter, hasCrashPad, confidence);
      return {
        key,
        value: values[key],
        target,
        importance,
        match,
        verified: !(line.estimated && UNVERIFIED_WHEN_ESTIMATED.includes(key)),
      };
    });

    // The open-dimension-list half of scoring: every implicit-catalog
    // variable the adaptive interview or the drag-and-drop learner has
    // real confidence about gets folded in here, exactly like a fixed
    // dimension — this is the actual wiring that was previously missing
    // (implicitWeights fed rank-learning.ts's own internal predictive model
    // and the "Also learned from your drags" explanatory footnote, but
    // never the score a pilot actually sees). Gated on confidence, not just
    // a nonzero weight, so a single noisy data point can't move the sort
    // order the way a real, repeatedly-confirmed preference can.
    const implicitValues = implicitValuesByLine[line.id];
    const implicitDimensions: DimensionScore[] = implicitValues
      ? IMPLICIT_VARIABLES.flatMap((variable) => {
          const weight = implicitWeights[variable.id] ?? 0;
          const confidence = implicitConfidence[variable.id] ?? 0;
          if (confidence < MIN_CONFIDENCE_FOR_IMPLICIT_SCORING || Math.abs(weight) < 0.01) return [];
          const value = implicitValues[variable.id];
          const target = weight > 0 ? 1 : 0;
          return [
            {
              key: variable.id,
              value,
              target,
              importance: Math.min(1, Math.abs(weight) / 1.5) * confidence,
              match: matchFromDistance(value, target),
              // Estimated lines only ever produce a neutral 0.5 placeholder
              // for every implicit variable (see computeImplicitLineValues),
              // never a real measurement — the same honesty policy the
              // fixed dimensions already apply via UNVERIFIED_WHEN_ESTIMATED.
              verified: !line.estimated,
            },
          ];
        })
      : [];

    const allDimensions = [...dimensions, ...implicitDimensions];

    const totalImportance = allDimensions.reduce(
      (s, d) => s + Math.max(d.importance, 0.05),
      0
    );
    const score =
      (allDimensions.reduce(
        (s, d) => s + d.match * Math.max(d.importance, 0.05),
        0
      ) /
        totalImportance) *
      100;

    const topDimensions = [...allDimensions]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 3);

    // Computed together, then partitioned, so "violated" and "near-miss"
    // stay mutually exclusive by construction rather than by an extra
    // dedup pass — a fact only ever reaches the near-miss check once its
    // own violation check has already come back null.
    const dealbreakerResults = dealbreakerFacts.map((fact) => ({
      fact,
      violation: dealbreakerViolatedFor(fact, line, values, implicitValues),
    }));
    const violatedDealbreakers = dealbreakerResults
      .map((r) => r.violation)
      .filter((v): v is DealbreakerViolation => v !== null);
    const nearMissDealbreakers = dealbreakerResults
      .filter((r) => r.violation === null)
      .map((r) => dealbreakerNearMissFor(r.fact, line, values, implicitValues))
      .filter((v): v is DealbreakerNearMiss => v !== null);
    // A cap, not a zero-out — see DEALBREAKER_SCORE_CAP's own doc comment.
    // Computed from the uncapped score; explanation/contributors/detractors
    // stay uncapped too, since they describe *why the dimensions scored as
    // they did*, a separate concern from the dealbreaker banner that
    // explains the cap itself.
    const finalScore = violatedDealbreakers.length > 0 ? Math.min(score, DEALBREAKER_SCORE_CAP) : score;

    return {
      line,
      score: Math.round(finalScore * 10) / 10,
      dimensions: allDimensions,
      topDimensions,
      explanation: explain(topDimensions, weights, implicitWeights),
      estimated: !!line.estimated,
      categoryScores: computeCategoryScores(allDimensions),
      ...topContributorsAndDetractors(allDimensions, weights, implicitWeights),
      violatedDealbreakers,
      nearMissDealbreakers,
      qualitativeTieIns: qualitativeTieInsForLine(qualitativeFacts, line),
      confidenceLevel: profileRichness?.level ?? null,
      historicalNote: historicalConsistencyNote({ dimensions: allDimensions }, priorTopLines),
      cumulativeCircadian: cumulativeCircadianByLine[i],
      hotelReviewTieIn: hotelReviewTieInForLine(line, qualitativeFacts, hotelQualityData),
    };
  });

  // Counterfactual needs to know the pack's own top score, which isn't
  // known until every line above has been scored — a second, cheap pass
  // rather than restructuring the loop above around a value it can't have
  // yet.
  const topScore = results.length > 0 ? Math.max(...results.map((r) => r.score)) : 0;
  return results.map((r) => ({
    ...r,
    counterfactual: computeCounterfactual(r, topScore, ranges),
  }));
}

export function rankLines(
  bidPack: BidPack,
  profile: PreferenceProfile,
  hotelQualityData: HotelQualityData = {},
  implicitValuesByLine: Record<string, Record<string, number>> = {},
  profileRichness?: ProfileRichness,
  priorTopLines?: LineSnapshot[] | null
): LineScore[] {
  return scoreBidPack(
    bidPack,
    profile,
    hotelQualityData,
    implicitValuesByLine,
    profileRichness,
    priorTopLines
  ).sort((a, b) => b.score - a.score);
}
