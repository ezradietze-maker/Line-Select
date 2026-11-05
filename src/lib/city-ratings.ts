import type { BidPack } from "@/types/bidpack";
import { hotelKey } from "@/lib/hotel-addresses";
import { monthsWords, seasonMonths, seasonOf, type SeasonScores } from "@/lib/seasons";
import type { CityMark, CityRating, CityRatingScore, CityReasonTag, CitySeasonGrades, CitySentiment } from "@/types/preferences";

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

/** Whether a city's rating says more than its grade — seasons, hotels, "I'd try it", reasons, a note: reason to keep a neutral one. */
export function saysMore(r: CityRating | undefined): boolean {
  return !!r && (hasSeasons(r.seasons) || Object.keys(r.hotels ?? {}).length > 0 || !!r.untried || !!r.note?.trim() || !!r.reasons?.length);
}

/** Without "I'd try it": a pilot who grades a city has a feeling about it. */
const withoutUntried = (r: CityRating): CityRating => {
  const out = { ...r };
  delete out.untried;
  return out;
};

/** Apply one rating change, keeping both maps in step. Neutral removes the city, unless its rating says more. */
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
    const kept = prev && withoutUntried(prev);
    if (kept && saysMore(kept)) nextRatings[code] = { ...kept, score: 0 };
    else delete nextRatings[code];
    delete nextSentiments[code];
  } else {
    nextRatings[code] = withoutUntried({ ...prev, score });
    nextSentiments[code] = sentimentFromRating(score)!;
  }
  return { ratings: nextRatings, sentiments: nextSentiments };
}

/**
 * Every marked city, four ways — what the calendar, trips and card chips show. Built from the pilot's own grades, so a
 * city they like isn't drawn as one they love; an older favorite/avoid mark (story, last cycle) stands where they gave
 * no grade. With a `month` (the bid month's), a city takes its grade for that month — Anchorage loved in July.
 */
export function cityMarks(ratings: Record<string, CityRating> | undefined, sentiments: Record<string, CitySentiment> = {}, month: number | null = null): Record<string, CityMark> {
  const marks: Record<string, CityMark> = {};
  for (const [code, s] of Object.entries(sentiments)) marks[code] = s;
  for (const code of Object.keys(ratings ?? {})) {
    const score = cityScoreInMonth(code, ratings ?? {}, sentiments, month);
    if (score >= 2) marks[code] = "love";
    else if (score === 1) marks[code] = "like";
    else if (score === -1) marks[code] = "dislike";
    else if (score <= -2) marks[code] = "avoid";
    else delete marks[code];
  }
  return marks;
}

/** The month (1 = January) a bid period is mostly in — its middle. Null without a start date. */
export function bidMonthOf(pack: { bidPeriodStart: string | null; bidPeriodDays: number }): number | null {
  if (!pack.bidPeriodStart) return null;
  const d = new Date(`${pack.bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.floor(pack.bidPeriodDays / 2));
  return d.getUTCMonth() + 1;
}

/** −1 … +1 per city, the scale the pilot brain's layover measures use. */
export function cityScoresFromRatings(ratings: Record<string, CityRating>): Record<string, number> {
  return Object.fromEntries(Object.entries(ratings).map(([code, r]) => [code, r.score / 2]));
}

/** The pilot's grades for single hotels, on the −1 … +1 scale, by `hotelKey`. */
export function hotelScoresFromRatings(ratings: Record<string, CityRating>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, r] of Object.entries(ratings)) for (const [hotel, score] of Object.entries(r.hotels ?? {})) out[hotelKey(code, hotel)] = score / 2;
  return out;
}

/** A rating's seasonal grades on the same −1 … +1 scale, for the cities whose grade changes with the season. */
export function citySeasonsFromRatings(ratings: Record<string, CityRating>): Record<string, SeasonScores> {
  const out: Record<string, SeasonScores> = {};
  for (const [code, r] of Object.entries(ratings)) {
    const s = r.seasons;
    if (!hasSeasons(s)) continue;
    out[code] = {
      ...(s.winter !== undefined ? { winter: s.winter / 2 } : {}),
      ...(s.summer !== undefined ? { summer: s.summer / 2 } : {}),
      ...(s.months?.months.length ? { months: [{ months: s.months.months, score: s.months.score / 2 }] } : {}),
    };
  }
  return out;
}

/** Whether a city's grade changes in any season. */
export function hasSeasons(s: CitySeasonGrades | undefined): s is CitySeasonGrades {
  return !!s && (s.winter !== undefined || s.summer !== undefined || !!s.months?.months.length);
}

/** A city's grade in a month (1 = January): its seasonal grade when it has one then, else its usual one. */
export function cityScoreInMonth(code: string, ratings: Record<string, CityRating>, sentiments: Record<string, CitySentiment>, month: number | null): CityRatingScore | 0 {
  const usual = effectiveCityScore(code, ratings, sentiments);
  const s = ratings[code]?.seasons;
  if (!hasSeasons(s) || month === null) return usual;
  if (s.months?.months.includes(month)) return s.months.score;
  const season = seasonOf(code, month);
  if (season === "winter" && s.winter !== undefined) return s.winter;
  if (season === "summer" && s.summer !== undefined) return s.summer;
  return usual;
}

/** Change one season's grade (undefined clears it). A city left with no seasons, a neutral grade and nothing said about it is no longer kept. */
export function rateCitySeason(
  code: string,
  season: "winter" | "summer" | "months",
  value: { score: CityRatingScore | 0; months?: number[] } | undefined,
  ratings: Record<string, CityRating>,
  sentiments: Record<string, CitySentiment>
): Record<string, CityRating> {
  const prev = ratings[code] ?? { score: effectiveCityScore(code, ratings, sentiments) };
  const seasons: CitySeasonGrades = { ...prev.seasons };
  if (season === "months") {
    if (value && value.months?.length) seasons.months = { months: [...value.months].sort((a, b) => a - b), score: value.score };
    else delete seasons.months;
  } else if (value) seasons[season] = value.score;
  else delete seasons[season];
  const next = { ...ratings };
  if (!hasSeasons(seasons)) {
    const rest = { ...prev };
    delete rest.seasons;
    if (rest.score === 0 && !saysMore(rest)) delete next[code];
    else next[code] = rest;
  } else next[code] = { ...prev, seasons };
  return next;
}

/** Grade one of a city's hotels (undefined: back to the city's grade). A city left neutral with nothing more to it goes. */
export function rateCityHotel(code: string, hotel: string, score: CityRatingScore | 0 | undefined, ratings: Record<string, CityRating>, sentiments: Record<string, CitySentiment>): Record<string, CityRating> {
  const prev = ratings[code] ?? { score: effectiveCityScore(code, ratings, sentiments) };
  const hotels = { ...prev.hotels };
  if (score === undefined) delete hotels[hotel];
  else hotels[hotel] = score;
  const nextRating: CityRating = { ...prev, hotels };
  if (!Object.keys(hotels).length) delete nextRating.hotels;
  const next = { ...ratings };
  if (nextRating.score === 0 && !saysMore(nextRating)) delete next[code];
  else next[code] = nextRating;
  return next;
}

/**
 * "Haven't been — I'd try it": the city goes neutral, never a dislike, and is said so to the brain. Turning it off
 * leaves it neutral.
 */
export function markCityUntried(code: string, untried: boolean, ratings: Record<string, CityRating>, sentiments: Record<string, CitySentiment>): { ratings: Record<string, CityRating>; sentiments: Record<string, CitySentiment> } {
  const nextSentiments = { ...sentiments };
  delete nextSentiments[code];
  const next = { ...ratings };
  const prev = withoutUntried(ratings[code] ?? { score: 0 });
  const rating: CityRating = untried ? { ...prev, score: 0, untried: true } : { ...prev, score: 0 };
  if (saysMore(rating)) next[code] = rating;
  else delete next[code];
  return { ratings: next, sentiments: nextSentiments };
}

/** "; Love in summer (Jun–Aug), Dislike in winter (Nov–Apr)" — a city's seasonal grades, with the months they fall in there. */
export function seasonWords(code: string, s: CitySeasonGrades | undefined, label: (score: number) => string): string {
  if (!hasSeasons(s)) return "";
  const months = seasonMonths(code);
  const parts: string[] = [];
  if (s.summer !== undefined) parts.push(`${label(s.summer)} in summer${months?.summer.length ? ` (${monthsWords(months.summer)})` : ""}`);
  if (s.winter !== undefined) parts.push(`${label(s.winter)} in winter${months?.winter.length ? ` (${monthsWords(months.winter)})` : " (it has none)"}`);
  if (s.months?.months.length) parts.push(`${label(s.months.score)} in ${monthsWords(s.months.months)}`);
  return `; ${parts.join(", ")}`;
}

/** "; at HILTON GARDEN: Love" — a city's hotels graded apart from it. */
export function hotelWords(hotels: Record<string, number> | undefined, label: (score: number) => string): string {
  const graded = Object.entries(hotels ?? {});
  return graded.length ? `; ${graded.map(([hotel, score]) => `at ${hotel}: ${label(score)}`).join(", ")}` : "";
}

/** The ratings as the pilot brain reads them, with the pilot's reasons — one block of the interview. */
export function describeCityRatings(ratings: Record<string, CityRating>): string {
  const label = (s: number) => CITY_RATING_STEPS.find((x) => x.score === s)?.label ?? String(s);
  const reason = (t: CityReasonTag) => CITY_REASONS.find((x) => x.tag === t)?.label.toLowerCase() ?? t;
  return Object.entries(ratings)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([code, r]) => `${code}: ${r.untried ? "Haven't been — would try it" : label(r.score)}${seasonWords(code, r.seasons, label)}${hotelWords(r.hotels, label)}${r.reasons?.length ? ` (${r.reasons.map(reason).join(", ")})` : ""}${r.note?.trim() ? ` — "${r.note.trim()}"` : ""}`)
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
  /** Every hotel the pack uses here, with its stays, most used first. */
  hotels: { name: string; stays: number }[];
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
      const hotels = [...e.hotels].sort((a, b) => b[1] - a[1]).map(([name, stays]) => ({ name, stays }));
      return { code, trips: e.trips.size, lines: e.lines.size, medianHours: hours[Math.floor(hours.length / 2)], minHours: hours[0], maxHours: hours[hours.length - 1], hotel: hotels[0]?.name ?? null, hotels, standbyDays: e.standby };
    })
    .sort((a, b) => b.lines - a.lines || b.trips - a.trips);
}
