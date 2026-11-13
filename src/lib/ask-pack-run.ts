import type { AskQuery } from "@/lib/brain/ask-pack";
import { cityScoresFromRatings, citySeasonsFromRatings, hotelScoresFromRatings } from "@/lib/city-ratings";
import { cityName } from "@/lib/city-names";
import { citySearchName } from "@/lib/hotels/airport-names";
import { measure, type PackMetrics } from "@/lib/metrics/compute";
import { METRICS_BY_ID, type MetricParams } from "@/lib/metrics/catalog";
import type { Region } from "@/lib/metrics/trip-facts";
import type { BidPack, Line } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import type { CityRating } from "@/types/preferences";

/**
 * A query from "Ask your pack" run over the pack in the browser: every line measured on each condition, the ones that
 * meet them all kept, sorted by the query's sort or else by the pilot's own ranking. Each line keeps the figures it
 * was kept on, so the answer shows its working.
 */

export interface AskResultLine {
  line: Line;
  /** Where it sits in the pilot's own ranking, 1 = their top line; null without one. */
  rank: number | null;
  /** Each condition's figure for this line, in order. */
  values: (number | null)[];
  sortValue: number | null;
}

const meets = (v: number | null, op: AskQuery["conditions"][number]["op"], target: number) =>
  v !== null && (op === "atMost" ? v <= target + 1e-9 : op === "atLeast" ? v >= target - 1e-9 : Math.abs(v - target) < 1e-9);

export function runAskQuery(query: AskQuery, pack: BidPack, pm: PackMetrics, home: MetricParams = {}, rankedIds: string[] = []): AskResultLine[] {
  const rankOf = new Map(rankedIds.map((id, i) => [id, i + 1]));
  const out: AskResultLine[] = [];
  for (const line of pack.lines) {
    const values = query.conditions.map((c) => measure(c.metric, line, pm, { ...home, ...c.params }));
    if (!query.conditions.every((c, i) => meets(values[i], c.op, c.value))) continue;
    const sortValue = query.sort ? measure(query.sort.metric, line, pm, { ...home, ...query.sort.params }) : null;
    out.push({ line, rank: rankOf.get(line.id) ?? null, values, sortValue });
  }
  const byRank = (a: AskResultLine, b: AskResultLine) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.line.lineNumber.localeCompare(b.line.lineNumber);
  if (query.sort) {
    const dir = query.sort.direction === "asc" ? 1 : -1;
    // Lines with no figure go last, and among themselves (and on equal figures) in the pilot's order.
    const bySort = (a: AskResultLine, b: AskResultLine) =>
      a.sortValue === null || b.sortValue === null ? Number(a.sortValue === null) - Number(b.sortValue === null) : dir * (a.sortValue - b.sortValue);
    return out.sort((a, b) => bySort(a, b) || byRank(a, b));
  }
  return out.sort(byRank);
}

// ---------------------------------------------------------------- checked against the pack, before it's run

/**
 * The pilot's own city grades (with their seasons and hotels), as the ranking and the list's sorts read them: from the
 * model's city-graded priority, else straight from the city screen's ratings. Null when they've graded no city.
 */
export function cityGradesOf(model: PilotModel | null | undefined, ratings: Record<string, CityRating> | undefined): MetricParams | null {
  const graded = model?.criteria.find((c) => c.params?.cityScores && Object.keys(c.params.cityScores).length)?.params;
  if (graded) return { cityScores: graded.cityScores, citySeasons: graded.citySeasons, hotelScores: graded.hotelScores, hotelAreas: graded.hotelAreas };
  const cityScores = cityScoresFromRatings(ratings ?? {});
  if (!Object.keys(cityScores).length) return null;
  return { cityScores, citySeasons: citySeasonsFromRatings(ratings ?? {}), hotelScores: hotelScoresFromRatings(ratings ?? {}) };
}

/** Region names a pilot (or the model) might write, to the app's own. */
const REGION_WORDS: Record<string, Exclude<Region, "unknown">> = {
  domestic: "domestic", "lower 48": "domestic", conus: "domestic", us: "domestic", usa: "domestic", "united states": "domestic", stateside: "domestic",
  alaska: "alaska",
  hawaii: "hawaii", hawaiian: "hawaii",
  americas: "americas", "latin america": "americas", "south america": "americas", "central america": "americas", mexico: "americas", caribbean: "americas", canada: "americas",
  asia: "asia", "far east": "asia",
  oceania: "oceania", australia: "oceania", "south pacific": "oceania",
  europe: "europe", european: "europe",
  middleeast: "middleEast", "middle east": "middleEast", mideast: "middleEast",
  africa: "africa",
};

const plainWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const quoted = (items: string[]) => (items.length <= 1 ? `"${items[0] ?? ""}"` : `${items.slice(0, -1).map((x) => `"${x}"`).join(", ")} and "${items[items.length - 1]}"`);

/**
 * A cleaned query checked against this pack, in the browser, before it's run: city codes in any case or form ("hnl",
 * "HNL airport", "Honolulu") read as the pack's own code, regions by any common name ("Hawaii", "Europe"), and a
 * measure that counts city grades only with the pilot's grades to count. Anything it can't match — a city or region
 * the pack doesn't have, a city-graded measure with no grades — turns the answer into a plain "can't", naming it: run
 * as written, each of these read 0 on every line, so "Hawaii" found nothing and "no ZZZ layovers" listed the whole pack.
 */
export function checkAskQuery(query: AskQuery, pack: BidPack, pm: PackMetrics, cityGrades: MetricParams | null): AskQuery {
  if (query.cannotAnswer) return query;
  const codes = new Set<string>();
  const packRegions = new Set<Region>();
  for (const line of pack.lines)
    for (const f of pm.factsByLine.get(line.id) ?? []) {
      for (const l of f.legs) codes.add(l.from).add(l.to);
      for (const l of f.layovers) {
        codes.add(l.city);
        if (l.region !== "unknown") packRegions.add(l.region);
      }
    }
  const byName = new Map<string, string>();
  // By the city a pilot says ("Honolulu", "Tokyo Narita") and by its search name ("Hong Kong International Airport").
  for (const code of codes)
    for (const name of [cityName(code), citySearchName(code)]) {
      if (name.toUpperCase() === code) continue;
      for (const n of [name, name.split(",")[0]]) if (!byName.has(plainWords(n))) byName.set(plainWords(n), code);
    }
  const cityOf = (raw: unknown): string | null => {
    const text = String(raw ?? "").trim();
    if (codes.has(text.toUpperCase())) return text.toUpperCase();
    const words = plainWords(text.replace(/\b(airport|intl|international)\b/gi, ""));
    const named = byName.get(words);
    if (named) return named;
    // A code with words around it ("HNL airport", "CDG (Paris)"): only its own city's words. A city's own name isn't a
    // code in it: "San Juan" and "San Antonio" read as SAN, San Diego, on a pack that lays over there.
    for (const word of words.split(" ")) {
      const code = word.toUpperCase();
      if (word.length !== 3 || !codes.has(code)) continue;
      const own = new Set(plainWords(`${cityName(code)} ${citySearchName(code)}`).split(" "));
      if (words.split(" ").every((w) => w === word || own.has(w))) return code;
    }
    return null;
  };
  const regionOf = (raw: unknown): Region | null => {
    const w = plainWords(String(raw ?? ""));
    const r = REGION_WORDS[w] ?? REGION_WORDS[w.replace(/ /g, "")];
    return r && packRegions.has(r) ? r : null;
  };

  const noGrades: string[] = [];
  const noCity: string[] = [];
  const noRegion: string[] = [];
  const checked = (metric: string, params: MetricParams | undefined, label: string): MetricParams | undefined => {
    if (METRICS_BY_ID.get(metric)?.params?.includes("cityScores") && !cityGrades) noGrades.push(label);
    if (!params) return params;
    const out: MetricParams = { ...params };
    if (params.cities) {
      out.cities = [];
      for (const c of params.cities) {
        const code = cityOf(c);
        if (code) out.cities.push(code);
        else noCity.push(String(c));
      }
    }
    if (params.regions) {
      out.regions = [];
      for (const r of params.regions) {
        const region = regionOf(r);
        if (region) out.regions.push(region);
        else noRegion.push(String(r));
      }
    }
    return out;
  };
  const conditions = query.conditions.map((c) => ({ ...c, params: checked(c.metric, c.params, c.label) }));
  const sort = query.sort ? { ...query.sort, params: checked(query.sort.metric, query.sort.params, METRICS_BY_ID.get(query.sort.metric)?.label ?? "the order asked for") } : null;

  const problems = [
    noGrades.length ? `${quoted(noGrades)} ${noGrades.length === 1 ? "counts" : "count"} from how you rated each city, and there are no city ratings yet — rate the cities first, then ask again.` : "",
    noCity.length ? `This pack's trips don't go to ${quoted(noCity)}.` : "",
    noRegion.length ? `This pack has no layovers in ${quoted(noRegion)}.` : "",
  ].filter(Boolean);
  if (problems.length) return { ...query, conditions: [], sort: null, cannotAnswer: problems.join(" ") };
  return { ...query, conditions, sort };
}
