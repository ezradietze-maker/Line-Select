import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { answerNeed, hubsFor, secondHubsFor, type ScheduledFlight, type TravelAnswer } from "@/lib/flights/itineraries";
import type { TravelNeed } from "@/lib/flights/needs";
import { getJson, setJson } from "@/lib/server/kv";
import { distanceKm } from "@/lib/metrics/home-travel";

/**
 * Real airline departure boards from AeroDataBox, for counting a
 * commuter's flights (see `lib/flights/`). A board is one airport's
 * departures over half a local day — the most one call covers on the Starter
 * plan — and is cached for six days (the plan allows seven), shared by every
 * pilot: the second pilot commuting from the same city that month costs
 * nothing.
 *
 * Airline schedules repeat week to week, so a date further out reads the
 * same weekday's board from the coming week (or, past an airline schedule
 * change, from the first week of the new schedule), moved forward by whole
 * weeks on the local clock so a daylight-saving change keeps flights at
 * their local times. Next month's commute costs a week or two of boards per
 * airport, not a month. The provider's future schedules have gaps at some
 * airports, so a board that comes back empty or thin is replaced by last
 * week's real flying on the same weekday; and rows whose times can't be
 * right for their distance are dropped.
 *
 * It never spends the last of the month's allowance: every response reports
 * the units left, and below a floor it stops calling and the app falls back
 * to estimated travel times.
 */

const API = "https://api.aerodatabox.com";
const CACHE_SECONDS = 6 * 24 * 3600;
const EMPTY_CACHE_SECONDS = 24 * 3600;
/** A board with fewer than this share of the flights the same airport shows on its other half-days is a gap, not a quiet day. */
const THIN = 0.5;
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

/**
 * The provider's data has the odd bad row — an arrival from another day, a one-minute hop, an eighteen-hour domestic
 * flight. A flight is kept only if its block time fits its distance: no faster than a jet plus taxi, no slower than a
 * slow propeller plus a long taxi.
 */
export function plausible(f: ScheduledFlight): boolean {
  const hours = (f.arr - f.dep) / 3_600_000;
  if (!(hours > 0) || hours > 20) return false;
  const km = distanceKm(f.from, f.to);
  return km === null || (hours >= km / 950 + 0.2 && hours <= km / 250 + 3);
}

type Direction = "Departure" | "Arrival";

interface AdbDeparture {
  number?: string;
  departure?: { airport?: { iata?: string }; scheduledTime?: { utc?: string; local?: string } };
  arrival?: {
    airport?: { iata?: string };
    scheduledTime?: { utc?: string; local?: string };
  };
}

/** One half-day board: an airport's departures — or, for filling gaps (see `loadArrivalFills`), its arrivals. */
async function fetchBoard(b: Block, key: string, direction: Direction = "Departure"): Promise<{ flights: ScheduledFlight[]; unitsLeft: number | null } | null> {
  const from = `${b.date}T${b.half ? "12:00" : "00:00"}`;
  const to = `${b.date}T${b.half ? "23:59" : "11:59"}`;
  const url = `${API}/flights/airports/iata/${b.airport}/${from}/${to}?direction=${direction}&withLeg=true&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
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
  const j = (await res.json()) as { departures?: AdbDeparture[]; arrivals?: AdbDeparture[] };
  const rows = (direction === "Departure" ? j.departures : j.arrivals) ?? [];
  const flights = rows.flatMap((d) => {
    const dep = parseTime(d.departure?.scheduledTime);
    const arr = parseTime(d.arrival?.scheduledTime);
    const from = direction === "Departure" ? b.airport : d.departure?.airport?.iata;
    const to = direction === "Departure" ? d.arrival?.airport?.iata : b.airport;
    const f = dep !== null && arr !== null && from && to && d.number ? { n: d.number, from, to, dep, arr } : null;
    return f && plausible(f) ? [f] : [];
  });
  return { flights, unitsLeft: Number.isFinite(unitsLeft) ? unitsLeft : null };
}

/** The last Sunday of a month — where the airlines' IATA schedule seasons turn (March and October). */
function lastSunday(year: number, month: number, zone: string): DateTime {
  let d = DateTime.fromObject({ year, month, day: 1 }, { zone }).endOf("month").startOf("day");
  while (d.weekday !== 7) d = d.minus({ days: 1 });
  return d;
}

/** The first day of the schedule season a date falls in. */
function seasonStart(date: DateTime, zone: string): DateTime {
  const winter = lastSunday(date.year, 10, zone);
  const summer = lastSunday(date.year, 3, zone);
  return date >= winter ? winter : date >= summer ? summer : lastSunday(date.year - 1, 10, zone);
}

/**
 * The real boards that can stand in for a block, best first, each with how many weeks later the block is:
 *
 * 1. The block's own date, when it's in the coming week.
 * 2. Further out, the same weekday in the first week of its own schedule season (when the airlines change schedules
 *    between now and then), then the same weekday in the coming week.
 * 3. Last week's flying on the same weekday, then the week before — it happened, so the provider has all of it, where
 *    its future schedules sometimes have gaps.
 */
export function standIns(b: Block, now: number): { block: Block; weeks: number }[] {
  const zone = timezoneForAirport(b.airport);
  if (!zone) return [{ block: b, weeks: 0 }];
  const today = DateTime.fromMillis(now, { zone }).startOf("day");
  const date = DateTime.fromISO(b.date, { zone });
  const days = Math.round(date.diff(today, "days").days);
  const dates: DateTime[] = [];
  if (days < 7) dates.push(date);
  else {
    const season = seasonStart(date, zone);
    if (season > today.plus({ days: 6 })) {
      let first = season;
      while (first.weekday !== date.weekday) first = first.plus({ days: 1 });
      dates.push(first);
    }
    dates.push(date.minus({ weeks: Math.floor(days / 7) }));
  }
  const lastWeek = date.minus({ weeks: days >= 0 ? Math.floor(days / 7) + 1 : 1 });
  dates.push(lastWeek, lastWeek.minus({ weeks: 1 }));
  const seen = new Set<string>();
  return dates.flatMap((d) => {
    const iso = d.toISODate()!;
    if (seen.has(iso)) return [];
    seen.add(iso);
    return [{ block: { ...b, date: iso }, weeks: Math.round(date.diff(d, "days").days / 7) }];
  });
}

/** The first board to try for a block (see `standIns`). */
export const standIn = (b: Block, now: number) => standIns(b, now)[0];

/** Moves a flight forward by whole weeks on its departure airport's local clock, keeping its block time. */
export function shiftWeeks(f: ScheduledFlight, weeks: number): ScheduledFlight {
  const dep = DateTime.fromMillis(f.dep, { zone: timezoneForAirport(f.from) ?? "UTC" })
    .plus({ weeks })
    .toMillis();
  return { ...f, dep, arr: dep + (f.arr - f.dep) };
}

/**
 * Loads the boards for a set of blocks, each from its best stand-in that isn't a gap (see `standIns`), moved forward
 * to its own dates. Stand-ins are tried in rounds, so a block whose first board is fine costs one board.
 */
async function loadBoards(
  blocks: Block[],
  stats: { fetched: number; cached: number; skipped: number },
  now = Date.now()
): Promise<{ boards: Map<string, ScheduledFlight[]>; gaps: Block[] }> {
  const wanted = [...new Map(blocks.map((b) => [blockKey(b), b])).values()].map((b) => ({ b, options: standIns(b, now) }));
  const real = new Map<string, ScheduledFlight[]>();
  // What a normal half-day at each airport looks like: the most flights any of its boards here shows.
  const usual = new Map<string, number>();
  const usualKey = (b: Block) => `${b.airport}|${b.half}`;
  const good = (b: Block, flights: ScheduledFlight[] | undefined) => !!flights && flights.length > 0 && flights.length >= THIN * (usual.get(usualKey(b)) ?? 0);
  const chosen = new Map<string, { block: Block; weeks: number }>();
  let pending = wanted;
  for (let round = 0; pending.length > 0; round++) {
    const tries = pending.filter((w) => round < w.options.length);
    if (tries.length === 0) break;
    for (const [k, v] of await loadRealBoards(
      tries.map((w) => w.options[round].block),
      stats
    ))
      real.set(k, v);
    for (const w of tries) {
      const n = real.get(blockKey(w.options[round].block))?.length ?? 0;
      usual.set(usualKey(w.b), Math.max(usual.get(usualKey(w.b)) ?? 0, n));
    }
    pending = [];
    for (const w of wanted) {
      if (chosen.has(blockKey(w.b))) continue;
      const tried = w.options.slice(0, round + 1);
      const ok = tried.find((o) => good(o.block, real.get(blockKey(o.block))));
      if (ok) chosen.set(blockKey(w.b), ok);
      else if (round + 1 < w.options.length) pending.push(w);
      else {
        // Nothing better anywhere: the fullest board tried (a quiet airport really is quiet).
        const best = tried.filter((o) => real.has(blockKey(o.block))).sort((x, y) => real.get(blockKey(y.block))!.length - real.get(blockKey(x.block))!.length)[0];
        if (best) chosen.set(blockKey(w.b), best);
      }
    }
  }
  const out = new Map<string, ScheduledFlight[]>();
  const gaps: Block[] = [];
  for (const w of wanted) {
    const c = chosen.get(blockKey(w.b));
    const flights = c && real.get(blockKey(c.block));
    if (flights) out.set(blockKey(w.b), c.weeks ? flights.map((f) => shiftWeeks(f, c.weeks)) : flights);
    // The first board wasn't usable: the provider's data for this airport and half-day has a gap.
    if (c !== w.options[0]) gaps.push(w.b);
  }
  return { boards: out, gaps };
}

/**
 * Where an airport's own board for a half-day is a gap, the provider is usually missing every flight touching it then
 * — so the flights into it are missing from the other airports' boards too. They come back from the same weekday's
 * real arrivals there last week (or the week before), moved forward: one arrivals board per gap.
 */
async function loadArrivalFills(gaps: Block[], stats: { fetched: number; cached: number; skipped: number }, now = Date.now()): Promise<ScheduledFlight[]> {
  const out: ScheduledFlight[] = [];
  let pending = [...new Map(gaps.map((b) => [blockKey(b), b])).values()].map((b) => {
    const zone = timezoneForAirport(b.airport) ?? "UTC";
    const today = DateTime.fromMillis(now, { zone }).toISODate()!;
    return { b, options: standIns(b, now).filter((o) => o.weeks > 0 && o.block.date < today) };
  });
  for (let round = 0; pending.length > 0 && round < 2; round++) {
    const tries = pending.filter((w) => round < w.options.length);
    const got = await loadRealBoards(
      tries.map((w) => w.options[round].block),
      stats,
      "Arrival"
    );
    pending = [];
    for (const w of tries) {
      const o = w.options[round];
      const flights = got.get(blockKey(o.block));
      if (flights?.length) out.push(...flights.map((f) => ({ ...shiftWeeks(f, o.weeks), filled: true as const })));
      else pending.push(w);
    }
  }
  return out;
}

/** Loads real boards from the cache, fetching the missing ones while the allowance holds. */
async function loadRealBoards(
  blocks: Block[],
  stats: { fetched: number; cached: number; skipped: number },
  direction: Direction = "Departure"
): Promise<Map<string, ScheduledFlight[]>> {
  const prefix = direction === "Departure" ? "adb:board:v1:" : "adb:arr:v1:";
  const key = process.env.AERODATABOX_API_KEY;
  const out = new Map<string, ScheduledFlight[]>();
  const unique = [...new Map(blocks.map((b) => [blockKey(b), b])).values()];
  const missing: Block[] = [];
  await Promise.all(
    unique.map(async (b) => {
      const hit = await getJson<ScheduledFlight[]>(`${prefix}${blockKey(b)}`);
      if (hit) {
        out.set(blockKey(b), hit.filter(plausible));
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
      const r = await fetchBoard(b, key, direction).catch(() => null);
      if (!r) continue;
      stats.fetched++;
      out.set(blockKey(b), r.flights);
      if (r.unitsLeft !== null) unitsLeft = r.unitsLeft;
      // An empty board is often a gap in the provider's data rather than a quiet day — asked again tomorrow.
      await setJson(`${prefix}${blockKey(b)}`, r.flights, {
        ttlSeconds: r.flights.length ? CACHE_SECONDS : EMPTY_CACHE_SECONDS,
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

/** Airline ways that are plenty: past this, more hubs wouldn't change how a commute reads. */
const ENOUGH_WAYS = 5;
const HUB_ROUNDS = 3;
/** Going home, a connection can leave well after the last first flight that counts — the far end of a long-haul. */
const CONNECT_AHEAD_MS = 24 * 3_600_000;
/** How far into the future a need's flights reach: its deadline getting somewhere; going home, a day past its last first flight. */
const windowEnd = (n: TravelNeed) => n.arriveBy ?? n.departBefore + CONNECT_AHEAD_MS;

/**
 * Answers every need it can: first the origins' boards (nonstops), then — for needs without plenty of nonstops —
 * the boards of the hubs the origins actually fly to, for one-stop connections. The bid pack's own FedEx flights
 * (`jumpseats`) count alongside the airlines.
 */
export interface AnswerOptions {
  /** Connecting airports looked through per need (default 3). Audits raise it to see what the default misses. */
  maxHubs?: number;
}

export async function answerTravelNeeds(
  needs: TravelNeed[],
  jumpseats: ScheduledFlight[] = [],
  options: AnswerOptions = {}
): Promise<{
  answers: TravelAnswer[];
  stats: { fetched: number; cached: number; skipped: number };
  /** Every airport's departures over a need's window, exactly as the answers saw them — for audits. */
  departuresFor: (n: TravelNeed) => (airport: string) => ScheduledFlight[] | undefined;
}> {
  const stats = { fetched: 0, cached: 0, skipped: 0 };
  const originBlocks = needs.flatMap((n) => n.from.flatMap((a) => blocksFor(a, n.departAfter, n.departBefore)));
  const { boards } = await loadBoards(originBlocks, stats);
  // Where the trip ends: its own board tells whether the provider's data there has a gap, and if so the flights into it
  // come back from last week's real arrivals (see `loadArrivalFills`).
  const destination = await loadBoards(
    needs.flatMap((n) => n.to.flatMap((d) => blocksFor(d, n.departAfter, windowEnd(n)))),
    stats
  );
  for (const [k, v] of destination.boards) if (!boards.has(k)) boards.set(k, v);
  const fills = await loadArrivalFills(destination.gaps, stats);
  const filledFrom = new Map<string, ScheduledFlight[]>();
  for (const f of fills) (filledFrom.get(f.from) ?? filledFrom.set(f.from, []).get(f.from)!).push(f);

  const companyFrom = new Map<string, ScheduledFlight[]>();
  for (const f of jumpseats) (companyFrom.get(f.from) ?? companyFrom.set(f.from, []).get(f.from)!).push(f);
  // An airport's departures: the airline board, plus any FedEx flights from it. A FedEx gateway counts even without its
  // airline board (an airline flight in, the jumpseat out); a pilot's own home airport never does — without its board,
  // what's known about getting out of it is incomplete.
  const lookFor = (n: TravelNeed) => (airport: string) => {
    // Where the trip starts, only first flights count; anywhere else, connections up to the window's far end.
    const end = n.from.includes(airport) ? n.departBefore : windowEnd(n);
    const board = departuresOver(boards, airport, n.departAfter, end);
    const company = (companyFrom.get(airport) ?? []).filter((f) => f.dep >= n.departAfter && f.dep <= end);
    if (!board) return company.length && !n.from.includes(airport) ? company : undefined;
    // Flights into the destination the provider's data lost, back from last week — unless the board has them after all.
    const filled = (filledFrom.get(airport) ?? []).filter(
      (f) => n.to.includes(f.to) && f.dep >= n.departAfter && f.dep <= end && !board.some((g) => g.n === f.n && g.to === f.to && Math.abs(g.dep - f.dep) < 6 * 3_600_000)
    );
    return company.length || filled.length ? [...board, ...filled, ...company] : board;
  };
  // A need without plenty of airline ways is worth a look through hubs: the likeliest three, then — while that still
  // leaves it short — the next three, and the three after. Counted on the airlines alone, so a FedEx flight only ever adds to what the airlines give.
  const short = (a: TravelAnswer | null) => !a || a.options - a.jumpseatWays < ENOUGH_WAYS;
  const tried = new Map<string, string[]>();
  let pass = needs.map((n) => answerNeed(n, lookFor(n)));
  for (let round = 0; round < HUB_ROUNDS; round++) {
    const hubBlocks = needs.flatMap((n, i) => {
      if (!short(pass[i])) return [];
      const hubs = hubsFor(n, lookFor(n), options.maxHubs, undefined, tried.get(n.id) ?? []);
      tried.set(n.id, [...(tried.get(n.id) ?? []), ...hubs]);
      return hubs.flatMap((hub) => blocksFor(hub, n.departAfter, windowEnd(n)));
    });
    if (!hubBlocks.length) break;
    for (const [k, v] of (await loadBoards(hubBlocks, stats)).boards) boards.set(k, v);
    pass = needs.map((n) => answerNeed(n, lookFor(n)));
  }

  // One connection leaves it without a backup (a small home airport and a trip ending overseas): a second connection.
  const stuck = needs.filter((_, i) => (pass[i]?.options ?? 2) < 2);
  const secondHubBlocks = stuck.flatMap((n) => {
    const look = lookFor(n);
    return secondHubsFor(n, look, tried.get(n.id) ?? hubsFor(n, look, options.maxHubs)).flatMap((hub) => blocksFor(hub, n.departAfter, windowEnd(n)));
  });
  if (secondHubBlocks.length) for (const [k, v] of (await loadBoards(secondHubBlocks, stats)).boards) boards.set(k, v);

  const answers = needs
    .map((n) => {
      const a = answerNeed(n, lookFor(n));
      return a && a.options < 2 ? answerNeed(n, lookFor(n), 2) : a;
    })
    .filter((a): a is TravelAnswer => a !== null);
  return { answers, stats, departuresFor: lookFor };
}
