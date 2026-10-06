import type { PreferenceFact } from "@/types/interview-session";
import type { CitySentiment } from "@/types/preferences";

/**
 * How the bidding story's facts and the city picker's picks become one
 * starting fact list for the turn loop. The picker runs after the story, so
 * it has the final word on every city: a story city is shown on the picker
 * already marked, and whatever the pilot leaves there is what holds.
 */

/** The cities the story itself named, love/avoid — the picker's starting marks, so the pilot sees them rather than re-tapping them. */
export function storyCitySentiments(storyFacts: PreferenceFact[]): Record<string, CitySentiment> {
  const picks: Record<string, CitySentiment> = {};
  for (const f of storyFacts) {
    if (f.measurable?.type === "city-sentiment") picks[f.measurable.code] = f.measurable.sentiment;
  }
  return picks;
}

/** Deterministic, network-free conversion of picker selections into real facts — so the turn loop's very first context already includes them, and the model can follow up on *why* rather than the picks sitting in a side channel it never sees. */
export function factsFromCityPreferences(cityPreferences: Record<string, CitySentiment>): PreferenceFact[] {
  return Object.entries(cityPreferences).map(([code, sentiment]) => ({
    id: crypto.randomUUID(),
    statement: `${sentiment === "love" ? "Loves" : "Wants to avoid"} layovers in ${code}.`,
    kind: "measurable",
    measurable: { type: "city-sentiment", code, sentiment },
    confidence: 1,
    importance: 0.6,
    source: { kind: "seed-question", questionKey: "cities" },
    turnIndex: 0,
  }));
}

/**
 * Every story fact, plus one fact per picker selection. A story city fact the
 * picker still agrees with is kept as-is (it carries the pilot's own words,
 * and a dealbreaker flag when there was one); one the pilot changed or
 * cleared on the picker is dropped, since the picker came later.
 */
export function mergeStoryAndCityFacts(
  storyFacts: PreferenceFact[],
  cityPreferences: Record<string, CitySentiment>
): PreferenceFact[] {
  const kept = storyFacts.filter(
    (f) => f.measurable?.type !== "city-sentiment" || cityPreferences[f.measurable.code] === f.measurable.sentiment
  );
  const coveredByStory = new Set(
    kept.flatMap((f) => (f.measurable?.type === "city-sentiment" ? [f.measurable.code] : []))
  );
  const pickerOnly = Object.fromEntries(Object.entries(cityPreferences).filter(([code]) => !coveredByStory.has(code)));
  return [...kept, ...factsFromCityPreferences(pickerOnly)];
}

/**
 * A commuter's home city, when it's one of this pack's layover cities: a
 * layover there is a night at home, which is worth more than any other
 * overnight. Marked as a loved city (shown on the city screen, where the
 * pilot can still change it), with the reason already on file so the
 * interview doesn't ask "what is it about DEN?".
 */
export function homeCityReasonFact(code: string): PreferenceFact {
  return {
    id: crypto.randomUUID(),
    statement: `${code} is home — a layover there is a night at home.`,
    kind: "qualitative",
    confidence: 1,
    importance: 0.6,
    source: { kind: "seed-question", questionKey: "commute-from" },
    turnIndex: 0,
    cityReason: { code, category: "people" },
  };
}

/** A 3-letter airport code, uppercased, or null for anything else. */
export function parseAirportCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
