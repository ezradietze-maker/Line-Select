import { coordinatesForAirport } from "@/lib/airport-coordinates";

/**
 * Weather for a layover city, from Open-Meteo (open data, no key): what the bid month's dates were like there last
 * year — a fair picture of what to pack for — and, when a stay falls within the next two weeks, the forecast for it.
 * Fetched from the browser and kept for the visit (the conditions now, a quarter hour); nothing is stored.
 */

export interface DailyWeather {
  /** Local date, "2026-10-14". */
  date: string;
  highF: number | null;
  lowF: number | null;
  precipIn: number | null;
  snowIn: number | null;
}

export interface TypicalWeather {
  /** The dates measured, last year's. */
  from: string;
  to: string;
  avgHighF: number;
  avgLowF: number;
  /** Days with a tenth of an inch of rain or more, and with any snow, out of `days`. */
  wetDays: number;
  snowDays: number;
  days: number;
}

/** The days' average high and low and how many were wet or snowy. Null with no days measured. */
export function summarizeWeather(daily: DailyWeather[]): TypicalWeather | null {
  const measured = daily.filter((d) => d.highF !== null && d.lowF !== null);
  if (!measured.length) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    from: measured[0].date,
    to: measured[measured.length - 1].date,
    avgHighF: avg(measured.map((d) => d.highF!)),
    avgLowF: avg(measured.map((d) => d.lowF!)),
    wetDays: measured.filter((d) => (d.precipIn ?? 0) >= 0.1).length,
    snowDays: measured.filter((d) => (d.snowIn ?? 0) > 0).length,
    days: measured.length,
  };
}

/** The same calendar dates one year earlier. */
export function sameDatesLastYear(start: string, days: number): { from: string; to: string } {
  const d = new Date(`${start}T12:00:00Z`);
  const from = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  const to = new Date(from.getTime() + (days - 1) * 86_400_000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

interface OpenMeteoDaily {
  daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum?: (number | null)[]; snowfall_sum?: (number | null)[] };
}

function toDaily(json: OpenMeteoDaily): DailyWeather[] {
  const d = json.daily;
  if (!d?.time) return [];
  return d.time.map((date, i) => ({
    date,
    highF: d.temperature_2m_max[i] ?? null,
    lowF: d.temperature_2m_min[i] ?? null,
    precipIn: d.precipitation_sum?.[i] ?? null,
    snowIn: d.snowfall_sum?.[i] ?? null,
  }));
}

const cache = new Map<string, Promise<DailyWeather[] | null>>();
const UNITS = "temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto";

/**
 * Open-Meteo's free API is licensed for non-commercial use only. Once pilots are paying we move to the commercial
 * ("customer") endpoints, which take a paid API key. Set NEXT_PUBLIC_OPEN_METEO_API_KEY to switch the browser over;
 * leave it unset to stay on the free hosts (local dev, and until the owner buys a plan). See docs/launch/paid-tiers.md.
 *
 * NOTE: these requests run in the browser (CitiesScreen is a client component), so the key ships in the page bundle and
 * is visible to anyone who opens the site. Open-Meteo bills per call, so a public key is a denial-of-wallet risk — the
 * checklist covers the mitigations (rate limits / a server proxy) to weigh before enabling it on the live site.
 */
const OPEN_METEO_KEY = process.env.NEXT_PUBLIC_OPEN_METEO_API_KEY;
// Commercial hosts when a key is set, the free hosts otherwise. Each free host `X.open-meteo.com` has a commercial
// twin `customer-X.open-meteo.com`; only the host and the trailing apikey differ, the query is identical.
const FORECAST_HOST = OPEN_METEO_KEY ? "https://customer-api.open-meteo.com" : "https://api.open-meteo.com";
const ARCHIVE_HOST = OPEN_METEO_KEY ? "https://customer-archive-api.open-meteo.com" : "https://archive-api.open-meteo.com";
// Appended to every request so the commercial plan counts and bills the call; empty string on the free tier.
const API_KEY_PARAM = OPEN_METEO_KEY ? `&apikey=${encodeURIComponent(OPEN_METEO_KEY)}` : "";

function fetchDaily(url: string): Promise<DailyWeather[] | null> {
  const known = cache.get(url);
  if (known) return known;
  const p = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<OpenMeteoDaily>) : null))
    .then((j) => (j ? toDaily(j) : null))
    .catch(() => null)
    .then((daily) => {
      // A failed request is asked again next time, not remembered as "no weather on record".
      if (daily === null) cache.delete(url);
      return daily;
    });
  cache.set(url, p);
  return p;
}

/** Last year's weather over the bid month's dates at a city; null when it can't be placed or reached. */
export async function typicalWeather(code: string, bidPeriodStart: string, days: number): Promise<TypicalWeather | null> {
  const at = coordinatesForAirport(code);
  if (!at) return null;
  const { from, to } = sameDatesLastYear(bidPeriodStart, days);
  const daily = await fetchDaily(
    `${ARCHIVE_HOST}/v1/archive?latitude=${at[0]}&longitude=${at[1]}&start_date=${from}&end_date=${to}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&${UNITS}${API_KEY_PARAM}`
  );
  return daily ? summarizeWeather(daily) : null;
}

/** The next 16 days' forecast at a city; null when it can't be placed or reached. */
export function forecastWeather(code: string): Promise<DailyWeather[] | null> {
  const at = coordinatesForAirport(code);
  if (!at) return Promise.resolve(null);
  return fetchDaily(
    `${FORECAST_HOST}/v1/forecast?latitude=${at[0]}&longitude=${at[1]}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&forecast_days=16&${UNITS}${API_KEY_PARAM}`
  );
}

/** The sky in a few kinds, from a WMO weather code — enough to draw and to say in a word. */
export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export const SKY_WORDS: Record<Sky, string> = {
  clear: "Clear",
  partly: "Partly cloudy",
  cloudy: "Overcast",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  storm: "Thunderstorms",
};

export function skyOf(wmo: number): Sky {
  if (wmo <= 1) return "clear";
  if (wmo === 2) return "partly";
  if (wmo === 3) return "cloudy";
  if (wmo === 45 || wmo === 48) return "fog";
  if (wmo >= 51 && wmo <= 57) return "drizzle";
  if ((wmo >= 71 && wmo <= 77) || wmo === 85 || wmo === 86) return "snow";
  if (wmo >= 95) return "storm";
  return "rain";
}

export interface CurrentWeather {
  tempF: number;
  sky: Sky;
  isDay: boolean;
}

interface OpenMeteoCurrent {
  current?: { temperature_2m: number | null; weather_code: number | null; is_day: number | null };
}

/** One location's current conditions from an Open-Meteo reply; null when it didn't say. */
export function toCurrent(json: OpenMeteoCurrent): CurrentWeather | null {
  const c = json.current;
  if (!c || c.temperature_2m === null || c.weather_code === null) return null;
  return { tempF: Math.round(c.temperature_2m), sky: skyOf(c.weather_code), isDay: c.is_day !== 0 };
}

/** How long "now" stays now: Open-Meteo's current conditions are every 15 minutes. */
export const CURRENT_WEATHER_FRESH_MS = 15 * 60_000;

const currentCache = new Map<string, { at: number; reply: Promise<Record<string, CurrentWeather>> }>();

/**
 * What it's like right now at each city, in one request for all of them (Open-Meteo takes a list of places and
 * answers with a list). Cities it can't place, or a failed request, are simply left out. Kept a quarter hour, not the
 * visit: a tab left open all afternoon showed the morning's conditions as now.
 */
export function currentWeather(codes: string[]): Promise<Record<string, CurrentWeather>> {
  const placed = codes.flatMap((code) => {
    const at = coordinatesForAirport(code);
    return at ? [{ code, at }] : [];
  });
  if (!placed.length) return Promise.resolve({});
  const url = `${FORECAST_HOST}/v1/forecast?latitude=${placed.map((p) => p.at[0]).join(",")}&longitude=${placed.map((p) => p.at[1]).join(",")}&current=temperature_2m,weather_code,is_day&${UNITS}${API_KEY_PARAM}`;
  const asked = Date.now();
  const known = currentCache.get(url);
  // By the quarter hour, so a screen asking again as one starts (`CitiesScreen`) gets the new one.
  if (known && Math.floor(known.at / CURRENT_WEATHER_FRESH_MS) === Math.floor(asked / CURRENT_WEATHER_FRESH_MS)) return known.reply;
  const p = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<OpenMeteoCurrent | OpenMeteoCurrent[]>) : null))
    .then((j) => {
      if (j === null) return null;
      // One place comes back as an object, several as a list in the order asked.
      const replies = Array.isArray(j) ? j : [j];
      const out: Record<string, CurrentWeather> = {};
      placed.forEach((p, i) => {
        const now = replies[i] ? toCurrent(replies[i]) : null;
        if (now) out[p.code] = now;
      });
      return out;
    })
    .catch(() => null)
    .then((out) => {
      if (out === null && currentCache.get(url)?.reply === p) currentCache.delete(url);
      return out ?? {};
    });
  currentCache.set(url, { at: asked, reply: p });
  return p;
}
