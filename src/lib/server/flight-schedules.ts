import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { answerNeed, hubsFor, type ScheduledFlight, type TravelAnswer } from "@/lib/flights/itineraries";
import type { TravelNeed } from "@/lib/flights/needs";
import { getJson, setJson } from "@/lib/server/kv";

/**
 * Real airline departure boards from AeroDataBox, for counting a
 * commuter's flights (see `lib/flights/`). A board is one airport's
 * departures over half a local day — the most one call covers on the Starter
 * plan — and is cached for six days (the plan allows seven), shared by every
 * pilot: the second pilot commuting from the same city that month costs
 * nothing.
 *
 * Airline schedules repeat week to week, so only the coming week is ever
 * fetched: a date further out reads the same weekday's board from the
 * coming week, moved forward by whole weeks on the local clock (so a
 * daylight-saving change keeps flights at their local times). Next month's
 * commute costs one week of boards per airport, not a month.
 *
 * It never spends the last of the month's allowance: every response reports
 * the units left, and below a floor it stops calling and the app falls back
 * to estimated travel times.
 */

const API = "https://api.aerodatabox.com";
const CACHE_SECONDS = 6 * 24 * 3600;
/** Calls stop when the month's remaining units fall to this — a margin for a busy bid week. */
const UNITS_FLOOR = 2000;
const UNITS_KEY = "adb:units-remaining";
/** The Starter plan allows 5 calls a second: calls start at most this often, and a refused one waits and tries again. */
const MIN_GAP_MS = 260;
const CONCURRENCY = 3;
const RETRIES = 3;

let nextSlot = 0;
async function paced<T>(call: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return call();
}

export function flightDataConfigured(): boolean {
  return !!process.env.AERODATABOX_API_KEY;
}

interface Block {
  airport: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** 0 = 00:00–11:59 local, 1 = 12:00–23:59. */
  half: 0 | 1;
}

const blockKey = (b: Block) => `${b.airport}:${b.date}:${b.half}`;

/** The half-day boards that cover a span of real time at an airport. */
export function blocksFor(airport: string, from: number, to: number): Block[] {
  const zone = timezoneForAirport(airport);
  if (!zone) return [];
  const out: Block[] = [];
  let t = DateTime.fromMillis(from, { zone }).startOf("hour");
  const end = DateTime.fromMillis(to, { zone });
  t = t.set({ hour: t.hour < 12 ? 0 : 12 });
  while (t <= end) {
    out.push({ airport, date: t.toISODate()!, half: t.hour < 12 ? 0 : 1 });
    t = t.plus({ hours: 12 });
  }
  return out;
}

const parseTime = (x: { utc?: string; local?: string } | undefined): number | null => {
  const s = x?.utc ?? x?.local;
  if (!s) return null;
  // "2026-10-20 13:15Z" or "2026-10-20 06:15-07:00"
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
};

interface AdbDeparture {
  number?: string;
  departure?: { scheduledTime?: { utc?: string; local?: string } };
  arrival?: {
    airport?: { iata?: string };
    scheduledTime?: { utc?: string; local?: string };
  };
}

async function fetchBoard(b: Block, key: string): Promise<{ flights: ScheduledFlight[]; unitsLeft: number | null } | null> {
  const from = `${b.date}T${b.half ? "12:00" : "00:00"}`;
  const to = `${b.date}T${b.half ? "23:59" : "11:59"}`;
  const url = `${API}/flights/airports/iata/${b.airport}/${from}/${to}?direction=Departure&withLeg=true&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
  let res = await paced(() => fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" } }));
  for (let attempt = 1; res.status === 429 && attempt <= RETRIES; attempt++) {
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    res = await paced(() => fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" } }));
  }
  const unitsLeft = Number(res.headers.get("x-api-units-remaining"));
  if (res.status === 204)
    return {
      flights: [],
      unitsLeft: Number.isFinite(unitsLeft) ? unitsLeft : null,
    };
  if (!res.ok) {
    console.error("[flights] board failed", b, res.status);
    return null;
  }
  const j = (await res.json()) as { departures?: AdbDeparture[] };
  const flights = (j.departures ?? []).flatMap((d) => {
    const dep = parseTime(d.departure?.scheduledTime);
    const arr = parseTime(d.arrival?.scheduledTime);
    const to = d.arrival?.airport?.iata;
    return dep !== null && arr !== null && to && d.number ? [{ n: d.number, from: b.airport, to, dep, arr }] : [];
  });
  return { flights, unitsLeft: Number.isFinite(unitsLeft) ? unitsLeft : null };
}

/** The coming week's board that stands in for a block, and how many weeks later the block is; past and coming-week blocks stand for themselves. */
export function standIn(b: Block, now: number): { block: Block; weeks: number } {
  const zone = timezoneForAirport(b.airport);
  if (!zone) return { block: b, weeks: 0 };
  const today = DateTime.fromMillis(now, { zone }).startOf("day");
  const date = DateTime.fromISO(b.date, { zone });
  const days = Math.round(date.diff(today, "days").days);
  if (days < 7) return { block: b, weeks: 0 };
  const weeks = Math.floor(days / 7);
  return { block: { ...b, date: date.minus({ weeks }).toISODate()! }, weeks };
}

/** Moves a flight forward by whole weeks on each airport's local clock. */
export function shiftWeeks(f: ScheduledFlight, weeks: number): ScheduledFlight {
  const move = (ms: number, airport: string) => {
    const zone = timezoneForAirport(airport) ?? "UTC";
    return DateTime.fromMillis(ms, { zone }).plus({ weeks }).toMillis();
  };
  return { ...f, dep: move(f.dep, f.from), arr: move(f.arr, f.to) };
}

/** Loads the boards for a set of blocks — each from its coming-week stand-in, moved forward to its own dates. */
async function loadBoards(
  blocks: Block[],
  stats: { fetched: number; cached: number; skipped: number },
  now = Date.now()
): Promise<Map<string, ScheduledFlight[]>> {
  const wanted = [...new Map(blocks.map((b) => [blockKey(b), b])).values()].map((b) => ({ b, ...standIn(b, now) }));
  const real = await loadRealBoards(
    wanted.map((w) => w.block),
    stats
  );
  const out = new Map<string, ScheduledFlight[]>();
  for (const w of wanted) {
    const flights = real.get(blockKey(w.block));
    if (flights) out.set(blockKey(w.b), w.weeks ? flights.map((f) => shiftWeeks(f, w.weeks)) : flights);
  }
  return out;
}

/** Loads real boards from the cache, fetching the missing ones while the allowance holds. */
async function loadRealBoards(blocks: Block[], stats: { fetched: number; cached: number; skipped: number }): Promise<Map<string, ScheduledFlight[]>> {
  const key = process.env.AERODATABOX_API_KEY;
  const out = new Map<string, ScheduledFlight[]>();
  const unique = [...new Map(blocks.map((b) => [blockKey(b), b])).values()];
  const missing: Block[] = [];
  await Promise.all(
    unique.map(async (b) => {
      const hit = await getJson<ScheduledFlight[]>(`adb:board:v1:${blockKey(b)}`);
      if (hit) {
        out.set(blockKey(b), hit);
        stats.cached++;
      } else missing.push(b);
    })
  );
  if (!key || missing.length === 0) return out;
  let unitsLeft = (await getJson<number>(UNITS_KEY)) ?? Infinity;
  let i = 0;
  const worker = async () => {
    while (i < missing.length) {
      const b = missing[i++];
      if (unitsLeft <= UNITS_FLOOR) {
        stats.skipped++;
        continue;
      }
      const r = await fetchBoard(b, key).catch(() => null);
      if (!r) continue;
      stats.fetched++;
      out.set(blockKey(b), r.flights);
      if (r.unitsLeft !== null) unitsLeft = r.unitsLeft;
      await setJson(`adb:board:v1:${blockKey(b)}`, r.flights, {
        ttlSeconds: CACHE_SECONDS,
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (Number.isFinite(unitsLeft)) await setJson(UNITS_KEY, unitsLeft, { ttlSeconds: 40 * 24 * 3600 });
  return out;
}

/** All of an airport's departures over a span, from whichever boards are loaded; undefined when any are missing. */
function departuresOver(boards: Map<string, ScheduledFlight[]>, airport: string, from: number, to: number): ScheduledFlight[] | undefined {
  const blocks = blocksFor(airport, from, to);
  if (!blocks.length) return undefined;
  const out: ScheduledFlight[] = [];
  for (const b of blocks) {
    const flights = boards.get(blockKey(b));
    if (!flights) return undefined;
    out.push(...flights);
  }
  return out;
}

const windowEnd = (n: TravelNeed) => n.arriveBy ?? n.departBefore;

/**
 * Answers every need it can: first the origins' boards (nonstops), then — for needs without plenty of nonstops —
 * the boards of the hubs the origins actually fly to, for one-stop connections. The bid pack's own FedEx flights
 * (`jumpseats`) count alongside the airlines.
 */
export async function answerTravelNeeds(
  needs: TravelNeed[],
  jumpseats: ScheduledFlight[] = []
): Promise<{
  answers: TravelAnswer[];
  stats: { fetched: number; cached: number; skipped: number };
}> {
  const stats = { fetched: 0, cached: 0, skipped: 0 };
  const originBlocks = needs.flatMap((n) => n.from.flatMap((a) => blocksFor(a, n.departAfter, n.departBefore)));
  const boards = await loadBoards(originBlocks, stats);

  const companyFrom = new Map<string, ScheduledFlight[]>();
  for (const f of jumpseats) (companyFrom.get(f.from) ?? companyFrom.set(f.from, []).get(f.from)!).push(f);
  // An airport's departures: the airline board, plus any FedEx flights from it. A FedEx gateway counts even without its
  // airline board (an airline flight in, the jumpseat out); a pilot's own home airport never does — without its board,
  // what's known about getting out of it is incomplete.
  const lookFor = (n: TravelNeed) => (airport: string) => {
    const end = windowEnd(n);
    const board = departuresOver(boards, airport, n.departAfter, end);
    const company = (companyFrom.get(airport) ?? []).filter((f) => f.dep >= n.departAfter && f.dep <= end);
    if (!board) return company.length && !n.from.includes(airport) ? company : undefined;
    return company.length ? [...board, ...company] : board;
  };
  const firstPass = needs.map((n) => answerNeed(n, lookFor(n)));
  // A need with fewer than three nonstop options is worth a look through its origins' hubs.
  const hubBlocks = needs.flatMap((n, i) => {
    const a = firstPass[i];
    // Counted on the airlines alone, so a FedEx flight only ever adds to what the airlines give.
    if (a && a.options - a.jumpseatWays >= 3) return [];
    return hubsFor(n, lookFor(n)).flatMap((hub) => blocksFor(hub, n.departAfter, windowEnd(n)));
  });
  if (hubBlocks.length) for (const [k, v] of await loadBoards(hubBlocks, stats)) boards.set(k, v);

  const answers = needs.map((n) => answerNeed(n, lookFor(n))).filter((a): a is TravelAnswer => a !== null);
  return { answers, stats };
}
