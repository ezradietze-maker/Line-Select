import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { jumpseatsFor } from "@/lib/flights/client";
import type { TravelAnswer } from "@/lib/flights/itineraries";
import { travelNeedsForTrip, tripStartUtc, type TravelNeed } from "@/lib/flights/needs";
import type { CommuteStatus, FilterContext } from "@/lib/line-filters";
import { groupDepartures } from "@/lib/metrics/departures";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/**
 * "Only lines I can commute to on report day and home on release day", against real flights: the airline itineraries
 * and FedEx jumpseats `/api/flights/travel` already finds, asked about every line rather than the pilot's top ones.
 *
 * It goes by departures, not trips: trips flown back to back without going home need no commute between them, so a
 * departure asks for a way in to its first trip and a way home from its last.
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
}
export type CommuteAnswers = Record<string, CommuteAnswer>;

/** What this pilot lives somewhere the check can run from: a real airport that isn't the pack's base. */
export function canCheckCommute(bidPack: Pick<BidPack, "base">, homeAirport: string): boolean {
  return /^[A-Z]{3}$/.test(homeAirport) && homeAirport !== bidPack.base && !!timezoneForAirport(homeAirport);
}

/** A trip's travel for this filter: the pilot's buffers, on `travelNeedsForTrip`'s windows. */
function needsOfTrip(bidPack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip, s: CommuteSettings): TravelNeed[] {
  const needs = travelNeedsForTrip(bidPack, trip, {
    homeAirports: [s.homeAirport],
    commuteBufferHours: s.arriveBeforeReportHours,
    frontBufferHours: s.arriveBeforeReportHours,
    backRestHours: s.releaseToDepartureHours,
  });
  const extra = (s.releaseToDepartureHours - CURB_HOURS) * HOUR;
  return needs.map((n) => (n.kind === "homeFromBase" ? { ...n, departAfter: n.departAfter + extra, departBefore: n.departBefore + extra } : n));
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
      for (const n of needsOfTrip(bidPack, first, s)) if ((n.kind === "toBase" || n.kind === "deviateOut") && n.departBefore > now) seen.set(n.id, n);
      if (last.carriesIntoNextMonth) continue;
      for (const n of needsOfTrip(bidPack, last, s)) if ((n.kind === "homeFromBase" || n.kind === "deviateHome") && n.departBefore > now) seen.set(n.id, n);
    }
  }
  return [...seen.values()];
}

/**
 * Whose day a time belongs to, on the clock at home. Until 05:00 it's still last night, as a report or a late flight in
 * the catalog's commute measures is: for a 02:00 report the evening's flight is the commute, not a night at base, and a
 * flight landing home at 00:40 got the pilot home the day they were released.
 */
const NIGHT_RUNS_UNTIL_HOURS = 5;
const nightDay = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).minus({ hours: NIGHT_RUNS_UNTIL_HOURS }).toISODate();
const calendarDay = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).toISODate();
/** A flight leaving this day still makes this report without a night at base. */
export const leavesOnReportDay = (departure: number, report: number, zone: string) => calendarDay(departure, zone) === nightDay(report, zone);
/** A flight landing then gets the pilot home the day they were released. */
export const landsOnReleaseDay = (arrival: number, release: number, zone: string) => nightDay(arrival, zone) === calendarDay(release, zone);

/** When a trip's last leg or standby is done, as a real instant. */
function releaseAt(bidPack: Pick<BidPack, "bidPeriodStart" | "base">, trip: Trip): number | null {
  const start = tripStartUtc(bidPack, trip);
  if (start === null) return null;
  const f = computeTripFacts(trip);
  const end = Math.max(f.legs.at(-1)?.end ?? 0, f.duties.flatMap((d) => d.standbyLegs).at(-1)?.end ?? 0);
  return start + end * 60_000;
}

/** Of a trip's ways in or home: yes if any works on the day, no only if every way was asked and none does. */
function endStatus(needs: TravelNeed[], answers: CommuteAnswers, works: (a: CommuteAnswer) => boolean): CommuteStatus {
  if (needs.length === 0) return "unknown";
  let known = 0;
  for (const n of needs) {
    const a = answers[n.id];
    if (!a) continue;
    known++;
    if (works(a)) return "yes";
  }
  return known === needs.length ? "no" : "unknown";
}

/**
 * Whether real flights get the pilot in on each report day and home on each release day, on the clock at home. One end
 * that can't be done makes the line a no, whatever's still unknown; a trip already flown no longer counts.
 */
export function commuteStatusOfLine(line: Line, bidPack: Pick<BidPack, "bidPeriodStart" | "base">, s: CommuteSettings, answers: CommuteAnswers, now = Date.now()): CommuteStatus {
  if (line.estimated) return "unknown";
  const zone = timezoneForAirport(s.homeAirport);
  if (!zone) return "unknown";
  let unknown = false;
  let checked = 0;
  for (const { first, last } of departureEnds(line, bidPack, s)) {
    const report = tripStartUtc(bidPack, first);
    const inNeeds = needsOfTrip(bidPack, first, s).filter((n) => n.kind === "toBase" || n.kind === "deviateOut");
    if (report === null || inNeeds.length === 0) unknown = true;
    else if (inNeeds.every((n) => n.departBefore > now)) {
      const st = endStatus(inNeeds, answers, (a) => a.lastDeparture !== null && leavesOnReportDay(a.lastDeparture, report, zone));
      if (st === "no") return "no";
      checked++;
      if (st === "unknown") unknown = true;
    }
    if (last.carriesIntoNextMonth) continue;
    const release = releaseAt(bidPack, last);
    const homeNeeds = needsOfTrip(bidPack, last, s).filter((n) => n.kind === "homeFromBase" || n.kind === "deviateHome");
    if (release === null || homeNeeds.length === 0) unknown = true;
    else if (homeNeeds.every((n) => n.departBefore > now)) {
      const st = endStatus(homeNeeds, answers, (a) => a.firstArrival !== null && landsOnReleaseDay(a.firstArrival, release, zone));
      if (st === "no") return "no";
      checked++;
      if (st === "unknown") unknown = true;
    }
  }
  return unknown || checked === 0 ? "unknown" : "yes";
}

export function commuteStatuses(bidPack: BidPack, s: CommuteSettings, answers: CommuteAnswers, now = Date.now()): NonNullable<FilterContext["commute"]> {
  return new Map(bidPack.lines.map((l) => [l.id, commuteStatusOfLine(l, bidPack, s, answers, now)]));
}

const STORE_PREFIX = "line-select:commute-check:v1:";
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
    for (const k of Object.keys(window.localStorage)) if (k.startsWith(STORE_PREFIX) && k !== key) window.localStorage.removeItem(k);
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
  const missing = needs.filter((n) => !(n.id in answers));
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
    const j = (await res.json().catch(() => null)) as { configured?: boolean; answers?: TravelAnswer[] } | null;
    if (!j?.configured) return "unavailable";
    if (!Array.isArray(j.answers)) return "paused";
    for (const a of j.answers) answers[a.id] = { lastDeparture: a.lastDeparture, firstArrival: a.firstArrival };
    done += chunk.length;
    saveCommuteAnswers(bidPack.id, s, answers, now);
    onProgress({ done, total, answers: { ...answers } });
  }
  return "done";
}
