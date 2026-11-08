import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { jumpseatsFor } from "@/lib/flights/client";
import type { TravelAnswer } from "@/lib/flights/itineraries";
import { travelNeedsForTrip, tripStartUtc, type TravelNeed } from "@/lib/flights/needs";
import type { CommuteStatus, FilterContext } from "@/lib/line-filters";
import { groupDepartures } from "@/lib/metrics/departures";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/**
 * "Only lines I can commute to on report day and home on release day", against real flights: the airline itineraries
 * and FedEx jumpseats `/api/flights/travel` already finds, asked about every line rather than the pilot's top ones.
 *
 * It goes by departures, not trips: trips flown back to back without going home need no commute between them, so a
 * departure asks for a way in to its first trip and a way home from its last.
 *
 * Each question is asked about the day itself. The same questions asked about a whole day and night (as the commute
 * measures do, to count backups) find plenty of flights the evening before and stop there, without looking through the
 * hubs for that morning's connections: a line that's easy to commute to reads as one that isn't.
 *
 * Boards are shared and cached on the server and charged there under the spend guard; a board it won't fetch leaves a
 * question unanswered, and an unanswered question is "unknown" here, never a guess in either direction.
 */

export interface CommuteSettings {
  homeAirport: string;
  /** Hours before the report the pilot wants to be there. */
  arriveBeforeReportHours: number;
  /** Hours from block-in to the first flight the pilot would take home. */
  releaseToDepartureHours: number;
  jumpseats: boolean;
}

export const DEFAULT_COMMUTE_SETTINGS: Omit<CommuteSettings, "homeAirport"> = {
  arriveBeforeReportHours: 2,
  releaseToDepartureHours: 1,
  jumpseats: true,
};

const HOUR = 3_600_000;
/** What `travelNeedsForTrip` already allows from block-in to the curb. */
const CURB_HOURS = 1;

/** Just what the filter reads of an answer: every line's answers have to fit on the device beside the pack. */
export interface CommuteAnswer {
  lastDeparture: number | null;
  firstArrival: number | null;
  /** The server held back boards while answering, so this may not be the whole story: asked again next time. */
  partial?: true;
}
export type CommuteAnswers = Record<string, CommuteAnswer>;

/** What this pilot lives somewhere the check can run from: a real airport that isn't the pack's base. */
export function canCheckCommute(bidPack: Pick<BidPack, "base">, homeAirport: string): boolean {
  return /^[A-Z]{3}$/.test(homeAirport) && homeAirport !== bidPack.base && !!timezoneForAirport(homeAirport);
}

/**
 * Whose day a time belongs to. Until 05:00 it's still last night, as a report or a late flight in the catalog's commute
 * measures is: for a 02:00 report the evening's flight is the commute, not a night at base, and a flight landing home at
 * 00:40 got the pilot home the day they were released.
 */
const NIGHT_RUNS_UNTIL_HOURS = 5;
const nightDay = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).minus({ hours: NIGHT_RUNS_UNTIL_HOURS }).toISODate();
const calendarDay = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).toISODate();
/** A flight leaving home this day still makes a report (or a first flown leg) at `report` without a night away first. Report days go by the pack's clock at base, as it prints them. */
export const leavesOnReportDay = (departure: number, report: number, homeZone: string, baseZone: string) => calendarDay(departure, homeZone) === nightDay(report, baseZone);
/** A flight landing home then gets the pilot home the day they were released. */
export const landsOnReleaseDay = (arrival: number, release: number, homeZone: string, baseZone: string) => nightDay(arrival, homeZone) === calendarDay(release, baseZone);

interface Way {
  need: TravelNeed;
  /** What this way has to make the day of: the report or first flown leg on the way in, the release or last flown leg going home. */
  day: number;
  /** Its window closed before it opened: nothing can make it on the day (a report too early to fly in that morning). */
  impossible: boolean;
}

/** A trip's ways in or home, each narrowed to its own day, with the pilot's buffers. */
function waysOfTrip(bidPack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip, s: CommuteSettings, direction: "in" | "home"): Way[] {
  const homeZone = timezoneForAirport(s.homeAirport);
  const baseZone = timezoneForAirport(bidPack.base);
  if (!homeZone || !baseZone) return [];
  const needs = travelNeedsForTrip(bidPack, trip, {
    homeAirports: [s.homeAirport],
    commuteBufferHours: s.arriveBeforeReportHours,
    frontBufferHours: s.arriveBeforeReportHours,
    backRestHours: s.releaseToDepartureHours,
  });
  const extra = (s.releaseToDepartureHours - CURB_HOURS) * HOUR;
  const ways: Way[] = [];
  for (const n of needs) {
    const goingIn = n.kind === "toBase" || n.kind === "deviateOut";
    if (goingIn !== (direction === "in")) continue;
    if (goingIn) {
      const day = n.arriveBy! + s.arriveBeforeReportHours * HOUR;
      const opens = DateTime.fromISO(nightDay(day, baseZone)!, { zone: homeZone }).toMillis();
      ways.push({ need: { ...n, departAfter: opens, departBefore: n.arriveBy! }, day, impossible: opens >= n.arriveBy! });
    } else {
      const departAfter = n.kind === "homeFromBase" ? n.departAfter + extra : n.departAfter;
      const day = departAfter - s.releaseToDepartureHours * HOUR;
      const closes = DateTime.fromISO(calendarDay(day, baseZone)!, { zone: homeZone }).plus({ days: 1, hours: NIGHT_RUNS_UNTIL_HOURS }).toMillis();
      ways.push({ need: { ...n, departAfter, departBefore: closes }, day, impossible: departAfter >= closes });
    }
  }
  return ways;
}

/** A departure's first and last trips: the two ends of it the pilot travels to and from. */
function departureEnds(line: Line, bidPack: Pick<BidPack, "bidPeriodStart" | "base">, s: CommuteSettings): { first: Trip; last: Trip }[] {
  const options = { homeAirports: [s.homeAirport], commuteBufferHours: s.arriveBeforeReportHours, frontBufferHours: s.arriveBeforeReportHours, backRestHours: s.releaseToDepartureHours };
  return groupDepartures(line.trips, bidPack, options)
    .filter((d) => d.trips.length > 0)
    .map((d) => ({ first: d.trips[0], last: d.trips[d.trips.length - 1] }));
}

/** What the filter has to ask across the pack: each distinct question once, none about trips already flown. */
export function commuteNeedsForPack(bidPack: BidPack, s: CommuteSettings, now = Date.now()): TravelNeed[] {
  const seen = new Map<string, TravelNeed>();
  for (const line of bidPack.lines) {
    if (line.estimated) continue;
    for (const { first, last } of departureEnds(line, bidPack, s)) {
      const ways = [...waysOfTrip(bidPack, first, s, "in"), ...(last.carriesIntoNextMonth ? [] : waysOfTrip(bidPack, last, s, "home"))];
      for (const w of ways) if (!w.impossible && w.need.departBefore > now) seen.set(w.need.id, w.need);
    }
  }
  return [...seen.values()];
}

/**
 * Of an end's ways: yes if any works on the day, no only if every way was asked and none does. An answer given while the
 * server was holding back boards (`partial`) can prove a way works, but can't rule one out.
 */
function endStatus(ways: Way[], answers: CommuteAnswers, works: (a: CommuteAnswer, way: Way) => boolean): CommuteStatus {
  if (ways.length === 0) return "unknown";
  let settled = 0;
  for (const w of ways) {
    if (w.impossible) {
      settled++;
      continue;
    }
    const a = answers[w.need.id];
    if (!a) continue;
    if (works(a, w)) return "yes";
    if (!a.partial) settled++;
  }
  return settled === ways.length ? "no" : "unknown";
}

/**
 * Whether real flights get the pilot in on each report day and home on each release day. One end that can't be done makes
 * the line a no, whatever's still unknown; a trip already flown no longer counts.
 */
export function commuteStatusOfLine(line: Line, bidPack: Pick<BidPack, "bidPeriodStart" | "base">, s: CommuteSettings, answers: CommuteAnswers, now = Date.now()): CommuteStatus {
  if (line.estimated) return "unknown";
  const homeZone = timezoneForAirport(s.homeAirport);
  const baseZone = timezoneForAirport(bidPack.base);
  if (!homeZone || !baseZone) return "unknown";
  const flown = (ways: Way[]) => ways.length > 0 && ways.every((w) => w.need.departBefore <= now);
  let unknown = false;
  let checked = 0;
  const read = (st: CommuteStatus) => {
    checked++;
    if (st === "unknown") unknown = true;
    return st;
  };
  for (const { first, last } of departureEnds(line, bidPack, s)) {
    const ways = waysOfTrip(bidPack, first, s, "in");
    if (!flown(ways) && read(endStatus(ways, answers, (a, w) => a.lastDeparture !== null && leavesOnReportDay(a.lastDeparture, w.day, homeZone, baseZone))) === "no") return "no";
    if (last.carriesIntoNextMonth) continue;
    const home = waysOfTrip(bidPack, last, s, "home");
    if (!flown(home) && read(endStatus(home, answers, (a, w) => a.firstArrival !== null && landsOnReleaseDay(a.firstArrival, w.day, homeZone, baseZone))) === "no") return "no";
  }
  return unknown || checked === 0 ? "unknown" : "yes";
}

export function commuteStatuses(bidPack: BidPack, s: CommuteSettings, answers: CommuteAnswers, now = Date.now()): NonNullable<FilterContext["commute"]> {
  return new Map(bidPack.lines.map((l) => [l.id, commuteStatusOfLine(l, bidPack, s, answers, now)]));
}

// v2: questions asked about the day itself; v1's answers read their evening-before flights as the day failing.
const STORE_PREFIX = "line-select:commute-check:v2:";
/** Airline schedules move; kept on the device this long before asking again, as the commute's own flights are. */
const KEEP_MS = 3 * 24 * HOUR;
/** The server takes 600 questions in one request. */
const CHUNK = 500;

const storeKey = (bidPackId: string, s: CommuteSettings) => `${STORE_PREFIX}${bidPackId}:${s.homeAirport}/${s.arriveBeforeReportHours}/${s.releaseToDepartureHours}/${s.jumpseats ? "js" : "no-js"}`;

export function loadCommuteAnswers(bidPackId: string, s: CommuteSettings, now = Date.now()): CommuteAnswers {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storeKey(bidPackId, s));
    const stored = raw ? (JSON.parse(raw) as { savedAt: number; answers: CommuteAnswers }) : null;
    return stored && now - stored.savedAt < KEEP_MS && stored.answers && typeof stored.answers === "object" ? stored.answers : {};
  } catch {
    return {};
  }
}

function saveCommuteAnswers(bidPackId: string, s: CommuteSettings, answers: CommuteAnswers, now: number): void {
  try {
    // One check at a time: the bid pack itself needs the room.
    const key = storeKey(bidPackId, s);
    for (const k of Object.keys(window.localStorage)) if (k.startsWith("line-select:commute-check:") && k !== key) window.localStorage.removeItem(k);
    window.localStorage.setItem(key, JSON.stringify({ savedAt: now, answers }));
  } catch {
    // A full store just means asking again next time; the server's boards are already paid for.
  }
}

export type CommuteCheckEnd = "done" | "unavailable" | "paused";

export interface CommuteCheckProgress {
  done: number;
  total: number;
  answers: CommuteAnswers;
}

/**
 * Asks what isn't known yet, a batch at a time, keeping what comes back as it comes. "unavailable": flight data isn't
 * set up. "paused": the server stopped answering (a rate or spend limit, a network failure); what it had stays.
 */
export async function runCommuteCheck(
  bidPack: BidPack,
  s: CommuteSettings,
  onProgress: (p: CommuteCheckProgress) => void,
  { now = Date.now(), fetcher = fetch, signal }: { now?: number; fetcher?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CommuteCheckEnd> {
  const answers: CommuteAnswers = { ...loadCommuteAnswers(bidPack.id, s, now) };
  const needs = commuteNeedsForPack(bidPack, s, now);
  const missing = needs.filter((n) => !answers[n.id] || answers[n.id].partial);
  const total = needs.length;
  let done = total - missing.length;
  onProgress({ done, total, answers });
  for (let i = 0; i < missing.length; i += CHUNK) {
    if (signal?.aborted) return "paused";
    const chunk = missing.slice(i, i + CHUNK);
    const res = await fetcher("/api/flights/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needs: chunk, jumpseats: s.jumpseats ? jumpseatsFor(bidPack, chunk) : [] }),
      signal,
    }).catch(() => null);
    if (!res?.ok) return "paused";
    const j = (await res.json().catch(() => null)) as { configured?: boolean; answers?: TravelAnswer[]; partial?: boolean } | null;
    if (!j?.configured) return "unavailable";
    if (!Array.isArray(j.answers)) return "paused";
    for (const a of j.answers) answers[a.id] = { lastDeparture: a.lastDeparture, firstArrival: a.firstArrival, ...(j.partial ? { partial: true as const } : {}) };
    done += chunk.length;
    saveCommuteAnswers(bidPack.id, s, answers, now);
    onProgress({ done, total, answers: { ...answers } });
  }
  return "done";
}
