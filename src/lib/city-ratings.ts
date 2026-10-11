import type { BidPack } from "@/types/bidpack";
import type { CityRating, CityRatingScore, CityReasonTag, CitySentiment } from "@/types/preferences";

/**
 * Graded layover-city ratings: the interview's city step, where a pilot says
 * how much they like every layover city in their pack and why. Location is
 * half of what makes a layover good, and only the pilot knows which cities
 * have their food, their friends, a bed that doesn't hurt their back.
 */

export const CITY_RATING_STEPS: { score: CityRatingScore | 0; label: string }[] = [
  { score: -2, label: "Avoid" },
  { score: -1, label: "Dislike" },
  { score: 0, label: "Neutral" },
  { score: 1, label: "Like" },
  { score: 2, label: "Love" },
];

export const CITY_REASONS: { tag: CityReasonTag; label: string }[] = [
  { tag: "food", label: "Food nearby" },
  { tag: "hotel", label: "The hotel" },
  { tag: "bed", label: "Bed & pillows" },
  { tag: "things-to-do", label: "Things to do" },
  { tag: "friends", label: "Friends there" },
  { tag: "shopping", label: "Shopping & movies" },
  { tag: "hassle", label: "Hassle (customs, systems)" },
  { tag: "weather", label: "Weather & season" },
];

/** The old two-way sentiment, for scoring that only knows favorite/avoid. */
export function sentimentFromRating(score: number): CitySentiment | null {
  if (score >= 1) return "love";
  if (score <= -1) return "avoid";
  return null;
}

/** What a city's rating is: the pilot's own grade, or what an earlier favorite/avoid mark (story, last cycle) implies. */
export function effectiveCityScore(code: string, ratings: Record<string, CityRating>, sentiments: Record<string, CitySentiment>): CityRatingScore | 0 {
  const r = ratings[code];
  if (r) return r.score;
  const s = sentiments[code];
  return s === "love" ? 2 : s === "avoid" ? -2 : 0;
}

/** Apply one rating change, keeping both maps in step. Neutral with no reasons or note removes the city. */
export function rateCity(
  code: string,
  score: CityRatingScore | 0,
  ratings: Record<string, CityRating>,
  sentiments: Record<string, CitySentiment>
): { ratings: Record<string, CityRating>; sentiments: Record<string, CitySentiment> } {
  const nextRatings = { ...ratings };
  const nextSentiments = { ...sentiments };
  const prev = ratings[code];
  if (score === 0) {
    delete nextRatings[code];
    delete nextSentiments[code];
  } else {
    nextRatings[code] = { ...prev, score };
    nextSentiments[code] = sentimentFromRating(score)!;
  }
  return { ratings: nextRatings, sentiments: nextSentiments };
}

/** −1 … +1 per city, the scale the pilot brain's layover measures use. */
export function cityScoresFromRatings(ratings: Record<string, CityRating>): Record<string, number> {
  return Object.fromEntries(Object.entries(ratings).map(([code, r]) => [code, r.score / 2]));
}

/** The ratings as the pilot brain reads them, with the pilot's reasons — one block of the interview. */
export function describeCityRatings(ratings: Record<string, CityRating>): string {
  const label = (s: number) => CITY_RATING_STEPS.find((x) => x.score === s)?.label ?? String(s);
  const reason = (t: CityReasonTag) => CITY_REASONS.find((x) => x.tag === t)?.label.toLowerCase() ?? t;
  return Object.entries(ratings)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([code, r]) => `${code}: ${label(r.score)}${r.reasons?.length ? ` (${r.reasons.map(reason).join(", ")})` : ""}${r.note?.trim() ? ` — "${r.note.trim()}"` : ""}`)
    .join("\n");
}

export interface CityFacts {
  code: string;
  /** Distinct trips in the pack laying over here. */
  trips: number;
  /** Lines with at least one layover here. */
  lines: number;
  /** Typical layover length here, hours (median), and the range. */
  medianHours: number;
  minHours: number;
  maxHours: number;
  /** The hotel used most often, when the pack prints one. */
  hotel: string | null;
  /** Hotel standby days here across distinct trips. */
  standbyDays: number;
}

/** What this pack actually holds in each layover city — so a pilot rates the layovers they'd really get, most-flown first. */
export function packCityFacts(bidPack: BidPack): CityFacts[] {
  const seenTrips = new Set<string>();
  const by = new Map<string, { trips: Set<string>; lines: Set<string>; hours: number[]; hotels: Map<string, number>; standby: number }>();
  const entry = (code: string) => {
    let e = by.get(code);
    if (!e) by.set(code, (e = { trips: new Set(), lines: new Set(), hours: [], hotels: new Map(), standby: 0 }));
    return e;
  };
  for (const line of bidPack.lines) {
    for (const trip of line.trips) {
      const tripKey = `${trip.pairingNumber ?? trip.id}|${trip.startDayIndex}`;
      const firstTime = !seenTrips.has(tripKey);
      seenTrips.add(tripKey);
      for (const duty of trip.schedule) {
        if (firstTime) {
          for (const leg of duty.legs) if (leg.isStandby) entry(leg.depAirport).standby++;
        }
        const lay = duty.layover;
        if (!lay) continue;
        const e = entry(lay.city);
        e.lines.add(line.id);
        if (firstTime) {
          e.trips.add(tripKey);
          e.hours.push(lay.hours);
          if (lay.hotelName) e.hotels.set(lay.hotelName, (e.hotels.get(lay.hotelName) ?? 0) + 1);
        }
      }
    }
  }
  return [...by]
    .filter(([, e]) => e.trips.size > 0)
    .map(([code, e]) => {
      const hours = [...e.hours].sort((a, b) => a - b);
      const hotel = [...e.hotels].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { code, trips: e.trips.size, lines: e.lines.size, medianHours: hours[Math.floor(hours.length / 2)], minHours: hours[0], maxHours: hours[hours.length - 1], hotel, standbyDays: e.standby };
    })
    .sort((a, b) => b.lines - a.lines || b.trips - a.trips);
}
