/**
 * Builds `src/lib/climate-normals.ts`: each airport's typical month — average high and low, how many nights freeze,
 * how many days are wet or snowy — from NOAA's Global Summary of the Month (public domain), measured at the nearest
 * weather station with a full record, averaged over 2006–2025.
 *
 * Usage: npx tsx scripts/build-climate-normals.ts [CODE ...]   (no codes: every airport in airport-coordinates.ts)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AIRPORT_COORDINATES } from "@/lib/airport-coordinates";

const FROM = "2006-01-01";
const TO = "2025-12-31";
const OUT = "src/lib/climate-normals.ts";
const CACHE = ".cache/climate";
const NEEDED = ["TMAX", "TMIN", "DT32"];

interface Station {
  id: string;
  name: string;
  km: number;
}

function km(a: [number, number], b: [number, number]): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`failed: ${url}`);
}

/** Stations near the airport with temperatures and freezing nights recorded through recent years, nearest first. */
async function stationsNear(at: [number, number], box: number): Promise<Station[]> {
  const bbox = [at[0] + box, at[1] - box, at[0] - box, at[1] + box].map((x) => x.toFixed(3)).join(",");
  const url = `https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=global-summary-of-the-month&bbox=${bbox}&startDate=${FROM}&endDate=${TO}&limit=50`;
  const d = (await getJson(url)) as {
    results?: { filePath: string; boundingPoints: { coordinates: [number, number] }[]; stations: { name: string; dataTypes: { id: string; coverage: number; dateRange: { start: string; end: string } }[] }[] }[];
  };
  const out: Station[] = [];
  for (const r of d.results ?? []) {
    const types = r.stations[0]?.dataTypes ?? [];
    const ok = NEEDED.every((id) => {
      const t = types.find((x) => x.id === id);
      // Coverage is over the station's whole history; whether this period has enough is checked month by month in `normals`.
      return t && t.dateRange.end >= "2012-01-01" && t.dateRange.start <= "2016-01-01";
    });
    if (!ok) continue;
    const [lon, lat] = r.boundingPoints[0].coordinates;
    out.push({ id: r.filePath.split("/").pop()!.replace(".csv", ""), name: r.stations[0].name, km: km(at, [lat, lon]) });
  }
  return out.sort((a, b) => a.km - b.km);
}

interface Row {
  DATE: string;
  TMAX?: string;
  TMIN?: string;
  DT32?: string;
  DP10?: string;
  DSNW?: string;
  SNOW?: string;
}

async function monthsOf(station: string): Promise<Row[]> {
  const url = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-summary-of-the-month&stations=${station}&dataTypes=TMAX,TMIN,DT32,DP10,DSNW,SNOW&startDate=${FROM}&endDate=${TO}&format=json&units=standard`;
  return (await getJson(url)) as Row[];
}

export interface MonthNormal {
  highF: number;
  lowF: number;
  /** Nights a month at or below freezing. */
  freezeNights: number;
  /** Days with a tenth of an inch of rain or melted snow or more. */
  wetDays: number | null;
  /** Days with an inch of snow or more; null where the station doesn't report snow. */
  snowDays: number | null;
}

function normals(rows: Row[], minYears = 5): MonthNormal[] | null {
  const by: Row[][] = Array.from({ length: 12 }, () => []);
  for (const r of rows) by[Number(r.DATE.slice(5, 7)) - 1].push(r);
  const avg = (rs: Row[], k: keyof Row) => {
    const xs = rs.map((r) => r[k]).filter((v): v is string => v !== undefined && v !== "").map(Number).filter(Number.isFinite);
    return xs.length >= minYears ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  };
  const out: MonthNormal[] = [];
  for (const rs of by) {
    const highF = avg(rs, "TMAX");
    const lowF = avg(rs, "TMIN");
    const freezeNights = avg(rs, "DT32");
    if (highF === null || lowF === null || freezeNights === null) return null;
    out.push({ highF, lowF, freezeNights, wetDays: avg(rs, "DP10"), snowDays: avg(rs, "DSNW") });
  }
  return out;
}

/**
 * Where no station near the airport has a long enough record (several abroad), the ERA5 reanalysis at the airport
 * itself, from Open-Meteo (CC BY 4.0), 2023–2025, day by day.
 */
async function reanalysis(at: [number, number]): Promise<MonthNormal[] | null> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${at[0]}&longitude=${at[1]}&start_date=2023-01-01&end_date=2025-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`;
  const d = (await getJson(url)) as { daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum: (number | null)[]; snowfall_sum: (number | null)[] } };
  if (!d.daily) return null;
  const rows: Row[] = [];
  const months = new Map<string, { hi: number[]; lo: number[]; freeze: number; wet: number; snow: number }>();
  d.daily.time.forEach((date, i) => {
    const hi = d.daily!.temperature_2m_max[i];
    const lo = d.daily!.temperature_2m_min[i];
    if (hi === null || lo === null) return;
    const key = date.slice(0, 7);
    let e = months.get(key);
    if (!e) months.set(key, (e = { hi: [], lo: [], freeze: 0, wet: 0, snow: 0 }));
    e.hi.push(hi);
    e.lo.push(lo);
    if (lo <= 32) e.freeze++;
    if ((d.daily!.precipitation_sum[i] ?? 0) >= 0.1) e.wet++;
    if ((d.daily!.snowfall_sum[i] ?? 0) >= 1) e.snow++;
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const [key, e] of months)
    rows.push({ DATE: key, TMAX: String(mean(e.hi)), TMIN: String(mean(e.lo)), DT32: String(e.freeze), DP10: String(e.wet), DSNW: String(e.snow) });
  return normals(rows, 3);
}

/** Stations further than this from the airport aren't its weather. */
const MAX_STATION_KM = 50;

async function airport(code: string, at: [number, number]): Promise<{ station: Station; months: MonthNormal[] } | null> {
  const cached = `${CACHE}/${code}.json`;
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const keep = (found: { station: Station; months: MonthNormal[] }) => (writeFileSync(cached, JSON.stringify(found)), found);
  for (const box of [0.15, 0.45]) {
    for (const station of (await stationsNear(at, box)).filter((s) => s.km <= MAX_STATION_KM).slice(0, 4)) {
      const months = normals(await monthsOf(station.id));
      if (months) return keep({ station, months });
    }
  }
  const months = await reanalysis(at);
  return months ? keep({ station: { id: "ERA5", name: "reanalysis at the airport (Open-Meteo, CC BY 4.0)", km: 0 }, months }) : null;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(AIRPORT_COORDINATES).sort();
  const table: Record<string, { station: string; km: number; months: MonthNormal[] }> = {};
  const missing: string[] = [];
  for (const code of codes) {
    const at = AIRPORT_COORDINATES[code] as [number, number] | undefined;
    if (!at) continue;
    const found = await airport(code, at);
    if (!found) {
      missing.push(code);
      console.log(`${code}: no station`);
      continue;
    }
    table[code] = { station: `${found.station.id} ${found.station.name}`, km: Math.round(found.station.km), months: found.months };
    const m = found.months;
    console.log(`${code}: ${found.station.id} ${found.station.name} (${Math.round(found.station.km)} km) Jan ${m[0].highF}/${m[0].lowF} Jul ${m[6].highF}/${m[6].lowF}`);
  }
  if (process.argv.slice(2).length) return;
  const rows = Object.entries(table)
    .map(([code, t]) => `  ${code}: m(${JSON.stringify(t.months.map((x) => [x.highF, x.lowF, x.freezeNights, x.wetDays, x.snowDays]))}), // ${t.station}, ${t.km} km`)
    .join("\n");
  writeFileSync(
    OUT,
    `/**
 * Each airport's typical month, from NOAA's Global Summary of the Month (public domain): the nearest weather station
 * within 50 km with five years or more of every month, averaged over 2006–2025; where there's none, the ERA5 reanalysis
 * at the airport (Open-Meteo, CC BY 4.0), 2023–2025. Built by \`scripts/build-climate-normals.ts\` — rerun it to add airports.
 * ${missing.length ? `No station with a full record near: ${missing.join(", ")}.` : "Every airport in airport-coordinates.ts has one."}
 */

export interface MonthNormal {
  /** Average daily high and low, °F. */
  highF: number;
  lowF: number;
  /** Nights a month at or below freezing. */
  freezeNights: number;
  /** Days with a tenth of an inch of rain (or melted snow) or more; null where the station doesn't report it. */
  wetDays: number | null;
  /** Days with an inch of snow or more; null where the station doesn't report snow. */
  snowDays: number | null;
}

type Raw = [number, number, number, number | null, number | null];
const m = (rows: Raw[]): MonthNormal[] => rows.map(([highF, lowF, freezeNights, wetDays, snowDays]) => ({ highF, lowF, freezeNights, wetDays, snowDays }));

/** Twelve months, January first. */
export const CLIMATE_NORMALS: Record<string, MonthNormal[]> = {
${rows}
};
`
  );
  console.log(`wrote ${Object.keys(table).length} airports; missing ${missing.length}: ${missing.join(" ")}`);
}

main();
