import { formatHoursValue } from "@/lib/interview-config";
import { lineStandbyDays } from "@/lib/standby";
import { targetParts, type TargetParts } from "@/lib/target-editing";
import type { Line } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

export type ChipTone = "good" | "warn" | "neutral";

export interface LineFactChip {
  /** The number itself — "15 days off", "8 departures", "HNL". */
  main: string;
  /** How it compares to what the pilot said — "in your 12–16", "below your 14 minimum". Empty when there's nothing to compare against. */
  note: string;
  tone: ChipTone;
}

/** A departures/credit figure this close to the pilot's pinned ideal counts as "what you asked for". */
const DEPARTURES_TOLERANCE = 1;
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

  const departures = compareToTarget(line.totalDepartures, targetParts(profile.explicitTargets.departures), DEPARTURES_TOLERANCE, int);
  chips.push({ main: `${line.totalDepartures} departure${line.totalDepartures === 1 ? "" : "s"}`, ...departures });

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
  const loved = lineCities.filter((c) => profile.cityPreferences[c] === "love");
  const avoided = lineCities.filter((c) => profile.cityPreferences[c] === "avoid");
  for (const code of loved.slice(0, 3)) chips.push({ main: `♥ ${code}`, note: "a favorite", tone: "good" });
  for (const code of avoided.slice(0, 3)) chips.push({ main: `✕ ${code}`, note: "one you avoid", tone: "warn" });

  return chips;
}

/** The chips as one line of plain text, for the "copy with notes" export. */
export function lineFactsText(chips: LineFactChip[]): string {
  return chips.map((c) => (c.note ? `${c.main} (${c.note})` : c.main)).join(" · ");
}
