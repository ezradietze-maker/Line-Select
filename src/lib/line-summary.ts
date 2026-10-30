import { formatValue } from "@/lib/brain/describe";
import { cityMarks } from "@/lib/city-ratings";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { CriterionResult } from "@/lib/scoring-v2/score";
import { formatHoursValue } from "@/lib/interview-config";
import { lineDutyPeriods } from "@/lib/duty-periods";
import { lineStandbyDays } from "@/lib/standby";
import { targetParts, type TargetParts } from "@/lib/target-editing";
import type { Line } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

export type ChipTone = "good" | "warn" | "neutral";

export interface LineFactChip {
  /** The number itself — "15 days off", "8 duty periods", "HNL". */
  main: string;
  /** How it compares to what the pilot said — "in your 12–16", "below your 14 minimum". Empty when there's nothing to compare against. */
  note: string;
  tone: ChipTone;
}

/** A duty-periods/credit figure this close to the pilot's pinned ideal counts as "what you asked for". */
const DUTY_PERIODS_TOLERANCE = 1;
const CREDIT_TOLERANCE_HOURS = 2;

function compareToTarget(
  value: number,
  parts: TargetParts,
  tolerance: number,
  fmt: (n: number) => string
): { note: string; tone: ChipTone } {
  const { min, ideal, max } = parts;
  if (min !== undefined && value < min) return { note: `below your ${fmt(min)} minimum`, tone: "warn" };
  if (max !== undefined && value > max) return { note: `over your ${fmt(max)} max`, tone: "warn" };
  if (min !== undefined && max !== undefined) return { note: `in your ${fmt(min)}–${fmt(max)}`, tone: "good" };
  if (min !== undefined) return { note: `meets your ${fmt(min)} minimum`, tone: "good" };
  if (max !== undefined) return { note: `within your ${fmt(max)} max`, tone: "good" };
  if (ideal !== undefined) {
    return Math.abs(value - ideal) <= tolerance
      ? { note: `right at your ${fmt(ideal)}`, tone: "good" }
      : { note: `you wanted ${fmt(ideal)}`, tone: "neutral" };
  }
  return { note: "", tone: "neutral" };
}

/**
 * The specific, checkable facts about one line, framed against what THIS
 * pilot said they want — the thing that actually differs from card to card.
 * Replaces the one-sentence "why" that named the same three top-weighted
 * factors for nearly every line (on a real 283-line pack: 11 distinct
 * sentences, one of them on 167 lines). Numbers and city codes a pilot can
 * verify against the bid pack beat adjectives they have to take on faith.
 */
export function buildLineFactChips(line: Line, profile: PreferenceProfile): LineFactChip[] {
  const chips: LineFactChip[] = [];
  const int = (n: number) => String(Math.round(n));

  const daysOff = compareToTarget(line.daysOff, targetParts(profile.explicitTargets.daysOff), 0, int);
  chips.push({ main: `${line.daysOff} days off`, ...daysOff });

  const dutyPeriodCount = lineDutyPeriods(line);
  const dutyPeriods = compareToTarget(dutyPeriodCount, targetParts(profile.explicitTargets.dutyPeriods), DUTY_PERIODS_TOLERANCE, int);
  chips.push({ main: `${dutyPeriodCount} duty period${dutyPeriodCount === 1 ? "" : "s"}`, ...dutyPeriods });
  // Landings, for reference; nothing to compare them against. Never takeoffs — the ex-pilot counts landings.
  chips.push({ main: `${line.totalLandings} landing${line.totalLandings === 1 ? "" : "s"}`, note: "", tone: "neutral" });

  const credit = compareToTarget(line.totalCreditHours, targetParts(profile.explicitTargets.creditHours), CREDIT_TOLERANCE_HOURS, formatHoursValue);
  chips.push({ main: `${formatHoursValue(line.totalCreditHours)} credit`, ...credit });

  const standbyDays = lineStandbyDays(line);
  if (standbyDays > 0) {
    const lean = profile.weights.hotelStandby ?? 0;
    chips.push({
      main: `${standbyDays} standby day${standbyDays === 1 ? "" : "s"}`,
      note: lean < 0 ? "you'd rather avoid" : lean > 0 ? "you like it" : "",
      tone: lean < 0 ? "warn" : lean > 0 ? "good" : "neutral",
    });
  }

  const lineCities = Array.from(new Set(line.trips.flatMap((t) => t.layoverCities)));
  // The pilot's own grades, four ways: a city they only like isn't called a favorite.
  const marks = cityMarks(profile.cityRatings, profile.cityPreferences);
  const loved = lineCities.filter((c) => marks[c] === "love");
  const liked = lineCities.filter((c) => marks[c] === "like");
  const disliked = lineCities.filter((c) => marks[c] === "dislike" || marks[c] === "avoid");
  for (const code of loved.slice(0, 3)) chips.push({ main: `♥ ${code}`, note: "a favorite", tone: "good" });
  for (const code of liked.slice(0, Math.max(0, 3 - loved.length))) chips.push({ main: `♡ ${code}`, note: "one you like", tone: "good" });
  for (const code of disliked.slice(0, 3)) chips.push({ main: `✕ ${code}`, note: marks[code] === "avoid" ? "one you avoid" : "one you dislike", tone: "warn" });

  return chips;
}

/** How many features a line card shows — there's no room for every one. */
export const FEATURES_SHOWN = 5;

/** A priority this line beats the pack's average line on by at least this many score points is one of its features. */
const GOOD_CONTRIBUTION = 0.3;

/** Priorities about which cities the layovers are in: as a feature, the line's cities the pilot likes, by name. */
const CITY_METRICS = new Set(["layoverValue", "layoverHoursInCities", "layoversInCities", "tripsTouchingCities"]);

/**
 * A line's features: what's good about it for this pilot, most important to them first — at most `limit`. Worse
 * features aren't listed here (yet).
 *
 * A pilot interviewed by the pilot brain gets their own priorities (`criterionResults`), each one this line does
 * better than the pack's average line on, in the order they weigh them: "♥ HNL ♡ IND", "3 departures from home",
 * "18 days off". Anyone else gets the plain facts (`buildLineFactChips`) that aren't against what they asked for.
 */
export function buildLineFeatures(line: Line, profile: PreferenceProfile, criterionResults: CriterionResult[] | undefined, limit = FEATURES_SHOWN): LineFactChip[] {
  if (!criterionResults?.length) {
    const chips = buildLineFactChips(line, profile).filter((c) => c.tone !== "warn");
    return [...chips.filter((c) => c.tone === "good"), ...chips.filter((c) => c.tone !== "good")].slice(0, limit);
  }
  const marks = cityMarks(profile.cityRatings, profile.cityPreferences);
  const lineCities = Array.from(new Set(line.trips.flatMap((t) => t.layoverCities)));
  const features: LineFactChip[] = [];
  const said = new Set<string>();
  for (const r of [...criterionResults].filter((x) => x.value !== null && x.contribution >= GOOD_CONTRIBUTION).sort((a, b) => b.weight - a.weight || b.contribution - a.contribution)) {
    const def = METRICS_BY_ID.get(r.metric);
    if (!def) continue;
    let main = formatValue(r.value!, def);
    if (CITY_METRICS.has(r.metric)) {
      // The cities themselves, loved before liked — the pilot reads "HNL", not "62 hours in cities you like".
      const liked = [...lineCities.filter((c) => marks[c] === "love").map((c) => `♥ ${c}`), ...lineCities.filter((c) => marks[c] === "like").map((c) => `♡ ${c}`)];
      if (liked.length) main = liked.slice(0, 3).join("  ");
    }
    if (said.has(main)) continue;
    said.add(main);
    features.push({ main, note: "", tone: "good" });
    if (features.length === limit) break;
  }
  return features;
}

/** The chips as one line of plain text, for the "copy with notes" export. */
export function lineFactsText(chips: LineFactChip[]): string {
  return chips.map((c) => (c.note ? `${c.main} (${c.note})` : c.main)).join(" · ");
}
