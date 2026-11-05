import { coordinatesForAirport } from "@/lib/airport-coordinates";

/**
 * Weather for a layover city, from Open-Meteo (open data, no key): what the bid month's dates were like there last
 * year — a fair picture of what to pack for — and, when a stay falls within the next two weeks, the forecast for it.
 * Fetched from the browser and kept for the visit; nothing is stored.
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

function fetchDaily(url: string): Promise<DailyWeather[] | null> {
  const known = cache.get(url);
  if (known) return known;
  const p = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<OpenMeteoDaily>) : null))
    .then((j) => (j ? toDaily(j) : null))
    .catch(() => null);
  cache.set(url, p);
  return p;
}

/** Last year's weather over the bid month's dates at a city; null when it can't be placed or reached. */
export async function typicalWeather(code: string, bidPeriodStart: string, days: number): Promise<TypicalWeather | null> {
  const at = coordinatesForAirport(code);
  if (!at) return null;
  const { from, to } = sameDatesLastYear(bidPeriodStart, days);
  const daily = await fetchDaily(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${at[0]}&longitude=${at[1]}&start_date=${from}&end_date=${to}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&${UNITS}`
  );
  return daily ? summarizeWeather(daily) : null;
}

/** The next 16 days' forecast at a city; null when it can't be placed or reached. */
export function forecastWeather(code: string): Promise<DailyWeather[] | null> {
  const at = coordinatesForAirport(code);
  if (!at) return Promise.resolve(null);
  return fetchDaily(
    `https://api.open-meteo.com/v1/forecast?latitude=${at[0]}&longitude=${at[1]}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&forecast_days=16&${UNITS}`
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

const currentCache = new Map<string, Promise<Record<string, CurrentWeather>>>();

/**
 * What it's like right now at each city, in one request for all of them (Open-Meteo takes a list of places and
 * answers with a list). Cities it can't place, or a failed request, are simply left out.
 */
export function currentWeather(codes: string[]): Promise<Record<string, CurrentWeather>> {
  const placed = codes.flatMap((code) => {
    const at = coordinatesForAirport(code);
    return at ? [{ code, at }] : [];
  });
  if (!placed.length) return Promise.resolve({});
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${placed.map((p) => p.at[0]).join(",")}&longitude=${placed.map((p) => p.at[1]).join(",")}&current=temperature_2m,weather_code,is_day&${UNITS}`;
  const known = currentCache.get(url);
  if (known) return known;
  const p = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<OpenMeteoCurrent | OpenMeteoCurrent[]>) : null))
    .then((j) => {
      // One place comes back as an object, several as a list in the order asked.
      const replies = j === null ? [] : Array.isArray(j) ? j : [j];
      const out: Record<string, CurrentWeather> = {};
      placed.forEach((p, i) => {
        const now = replies[i] ? toCurrent(replies[i]) : null;
        if (now) out[p.code] = now;
      });
      return out;
    })
    .catch(() => ({}));
  currentCache.set(url, p);
  return p;
}
