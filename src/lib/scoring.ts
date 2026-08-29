import { computeCircadianAssessment, computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import type { BidPack, Line } from "@/types/bidpack";
import type { HotelAmenitySummary, ReviewSentiment, ReviewSummary, ReviewThemeKey } from "@/types/hotel";
import type { CitySentiment, PreferenceProfile, PreferenceWeights } from "@/types/preferences";

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
  | "circadianHealth";

/** Dimensions driven by a -100..100 slider weight (everything except cityPreference, which is driven by a set of flagged cities instead). */
type WeightedDimensionKey = keyof PreferenceWeights;

export interface DimensionScore {
  key: DimensionKey;
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
  score: number;
  dimensions: DimensionScore[];
  topDimensions: DimensionScore[];
  explanation: string;
  /** Mirrors `line.estimated` for convenience. */
  estimated: boolean;
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
function computeCircadianHealthScore(line: Line, homeBaseOffsetMinutes: number | null): number | null {
  const values = line.trips
    .map((t) => computeCircadianAssessment(t, homeBaseOffsetMinutes))
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

const GENERAL_QUALITY_THEMES: ReviewThemeKey[] = ["cleanliness", "service", "sleepComfort", "breakfast", "safety"];

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
      gym: normalize(counts.gym, gymRange[0], gymRange[1]),
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
 */
function weightToImportance(
  key: WeightedDimensionKey,
  weight: number,
  hasExplicitTarget: boolean,
  isCommuter: boolean | null,
  hasCrashPad: boolean | null
): number {
  const base = Math.min(1, Math.abs(weight) / 100);
  let importance = hasExplicitTarget ? Math.max(base, 0.5) : base;
  if (isCommuter && (key === "reportTime" || key === "departures" || key === "deadheadTolerance")) {
    importance = Math.max(importance, 0.35);
  }
  if (isCommuter && hasCrashPad === false && key === "departures") {
    importance = Math.max(importance, 0.5);
  }
  return importance;
}

/** 1 - distance between value and target, so closer = higher score. */
function matchFromDistance(value: number, target: number): number {
  return 1 - Math.abs(value - target);
}

function weightFor(weights: PreferenceWeights, key: DimensionKey): number {
  return key === "cityPreference" || key === "layoverQuality" ? 0 : weights[key];
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
  }
}

function explain(topDimensions: DimensionScore[], weights: PreferenceWeights): string {
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
    .map((d) => hitPhrase(d.key, weightFor(weights, d.key)));

  const missDimension = [...verifiable]
    .filter((d) => d.match <= 0.5)
    .sort((a, b) => b.importance - a.importance)
    .map((d) => ({
      d,
      phrase: missPhrase(d.key, weightFor(weights, d.key), d.value, d.target),
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
  hotelQualityData: HotelQualityData = {}
): LineScore[] {
  const { weights, explicitTargets, cityPreferences, isCommuter, hasCrashPad } = profile;
  const rawMetrics = bidPack.lines.map(computeRawMetrics);
  const cityScores = bidPack.lines.map((l) => computeCityScore(l, cityPreferences));
  const hotelSubscores = computeHotelSubscores(bidPack, hotelQualityData);
  const layoverQualityScores = bidPack.lines.map((l) =>
    computeLayoverQualityScore(l, weights, hotelSubscores)
  );
  const homeBaseOffsetMinutes = computeHomeBaseOffsetMinutes(bidPack);
  const circadianScores = bidPack.lines.map((l) => computeCircadianHealthScore(l, homeBaseOffsetMinutes));
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
  };

  return bidPack.lines.map((line, i) => {
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
        const maxHotelWeight = Math.max(
          Math.abs(weights.hotelFood),
          Math.abs(weights.hotelGym),
          Math.abs(weights.hotelGrocery),
          Math.abs(weights.hotelQuiet),
          Math.abs(weights.hotelQuality)
        );
        const importance = Math.min(1, maxHotelWeight / 100);
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
        const importance = hasRealData ? Math.min(1, Math.abs(weights.circadianHealth) / 100) : 0;
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
      let hasExplicitTarget = false;

      if (key === "daysOff" && explicitTargets.daysOff !== undefined) {
        target = normalize(explicitTargets.daysOff, ranges.daysOff[0], ranges.daysOff[1]);
        hasExplicitTarget = true;
      } else if (key === "creditHours" && explicitTargets.creditHours !== undefined) {
        target = normalize(
          explicitTargets.creditHours,
          ranges.creditHours[0],
          ranges.creditHours[1]
        );
        hasExplicitTarget = true;
      } else if (key === "departures" && explicitTargets.departures !== undefined) {
        target = normalize(explicitTargets.departures, ranges.departures[0], ranges.departures[1]);
        hasExplicitTarget = true;
      } else {
        target = weightToTarget(weights[key]);
      }

      const importance = weightToImportance(key, weights[key], hasExplicitTarget, isCommuter, hasCrashPad);
      return {
        key,
        value: values[key],
        target,
        importance,
        match: matchFromDistance(values[key], target),
        verified: !(line.estimated && UNVERIFIED_WHEN_ESTIMATED.includes(key)),
      };
    });

    const totalImportance = dimensions.reduce(
      (s, d) => s + Math.max(d.importance, 0.05),
      0
    );
    const score =
      (dimensions.reduce(
        (s, d) => s + d.match * Math.max(d.importance, 0.05),
        0
      ) /
        totalImportance) *
      100;

    const topDimensions = [...dimensions]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 3);

    return {
      line,
      score: Math.round(score * 10) / 10,
      dimensions,
      topDimensions,
      explanation: explain(topDimensions, weights),
      estimated: !!line.estimated,
    };
  });
}

export function rankLines(
  bidPack: BidPack,
  profile: PreferenceProfile,
  hotelQualityData: HotelQualityData = {}
): LineScore[] {
  return scoreBidPack(bidPack, profile, hotelQualityData).sort((a, b) => b.score - a.score);
}
