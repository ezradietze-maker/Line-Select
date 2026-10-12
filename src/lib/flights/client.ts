import type { ScheduledFlight, TravelAnswer } from "@/lib/flights/itineraries";
import { jumpseatFlights } from "@/lib/flights/jumpseat";
import { travelNeedsForPack, type TravelNeed, type TravelParams } from "@/lib/flights/needs";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { DEFAULT_HOME_PARAMS } from "@/lib/metrics/home-travel";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The browser's side of the real-flight lookup: for a commuter, the airline
 * travel each trip in their top lines asks of them (see `needs.ts`), looked
 * up — airlines, and the FedEx flights in their own bid pack on the jumpseat — once (`/api/flights/travel`) and kept on this device for a few days.
 * Only the top lines are looked up — they're the ones that decide a bid, and
 * it keeps the lookups (which are metered) to what matters.
 *
 * Everything here is best-effort: without an answer the app keeps its
 * distance-based estimates.
 */

/** How many of the pilot's best lines get their trips' flights looked up (every line on a smaller pack). */
export const LINES_LOOKED_UP = 30;
/** Airline schedules move; looked-up flights are kept this long on the device before asking again. */
const KEEP_MS = 3 * 24 * 3600_000;
const STORE_PREFIX = "line-select:flights:v4:";
/** The server takes at most this many needs, and this many FedEx flights, in one request. */
const CHUNK = 500;
const MAX_JUMPSEATS = 4000;

/** The travel a pilot's model asks about — null for a pilot who lives at base, or whose home isn't known. */
export function travelParamsFor(bidPack: BidPack, model: PilotModel | undefined | null): TravelParams | null {
  const h = model?.home;
  if (!h || !h.commuter || h.airports.length === 0 || h.airports.includes(bidPack.base)) return null;
  return {
    homeAirports: h.airports.slice(0, 3),
    commuteBufferHours: h.commuteBufferHours ?? DEFAULT_HOME_PARAMS.commuteBufferHours,
    frontBufferHours: h.frontBufferHours ?? DEFAULT_HOME_PARAMS.frontBufferHours,
    backRestHours: h.backRestHours ?? DEFAULT_HOME_PARAMS.backRestHours,
  };
}

const storeKey = (bidPack: BidPack, p: TravelParams) =>
  `${STORE_PREFIX}${bidPack.id}:${p.homeAirports.join(",")}:${p.commuteBufferHours}/${p.frontBufferHours}/${p.backRestHours}`;

interface Stored {
  savedAt: number;
  answers: FlightAnswers;
}

function load(key: string): FlightAnswers | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return Date.now() - s.savedAt < KEEP_MS && s.answers && typeof s.answers === "object" ? s.answers : null;
  } catch {
    return null;
  }
}

function save(key: string, answers: FlightAnswers): void {
  try {
    // One pack's flights at a time — the bid pack itself needs the room.
    for (const k of Object.keys(localStorage)) if (k.startsWith("line-select:flights:") && k !== key) localStorage.removeItem(k);
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), answers } satisfies Stored));
  } catch {
    // A full store just means asking again next time.
  }
}

/** The flights already looked up for this pilot and pack, if any. */
export function cachedFlightAnswers(bidPack: BidPack, model: PilotModel | undefined | null): FlightAnswers | null {
  const p = travelParamsFor(bidPack, model);
  return p ? load(storeKey(bidPack, p)) : null;
}

/** The trips' travel worth looking up: the pilot's best lines by their own model, skipping anything already in the past. */
export function needsToLookUp(bidPack: BidPack, model: PilotModel, p: TravelParams, now = Date.now()): TravelNeed[] {
  const lineIds = new Set(
    rankPackV2(bidPack, model)
      .slice(0, LINES_LOOKED_UP)
      .map((s) => s.lineId)
  );
  const lines = bidPack.lines.filter((l) => lineIds.has(l.id));
  return travelNeedsForPack(bidPack, p, lines).filter((n) => n.departBefore > now);
}

/** The pack's FedEx flights that could matter to these needs — the ones flying inside any of their windows. */
function jumpseatsFor(bidPack: BidPack, needs: TravelNeed[]): ScheduledFlight[] {
  if (!needs.length) return [];
  const from = Math.min(...needs.map((n) => n.departAfter));
  const to = Math.max(...needs.map((n) => n.arriveBy ?? n.departBefore));
  return jumpseatFlights(bidPack)
    .filter((f) => f.dep >= from && f.dep <= to)
    .slice(0, MAX_JUMPSEATS);
}

const inFlight = new Map<string, Promise<FlightAnswers | null>>();

/**
 * Looks up (or finishes looking up) the real flights for a commuter's top lines, and keeps them. Resolves to every
 * answer known for this pilot and pack, or null when there's nothing to look up or the lookup isn't available. A second
 * call while one is running shares it — the interview starts it, and the results screen picks it up.
 */
export function lookUpFlights(bidPack: BidPack, model: PilotModel | undefined | null): Promise<FlightAnswers | null> {
  const p = model ? travelParamsFor(bidPack, model) : null;
  if (!model || !p) return Promise.resolve(null);
  const key = storeKey(bidPack, p);
  const running = inFlight.get(key);
  if (running) return running;

  const work = (async () => {
    const known = load(key) ?? {};
    const needs = needsToLookUp(bidPack, model, p).filter((n) => !(n.id in known));
    if (needs.length === 0) return Object.keys(known).length ? known : null;
    const answers: FlightAnswers = { ...known };
    for (let i = 0; i < needs.length; i += CHUNK) {
      const chunk = needs.slice(i, i + CHUNK);
      const res = await fetch("/api/flights/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needs: chunk, jumpseats: jumpseatsFor(bidPack, chunk) }),
      }).catch(() => null);
      if (!res?.ok) break;
      const j = (await res.json().catch(() => null)) as {
        configured?: boolean;
        answers?: TravelAnswer[];
      } | null;
      if (!j?.configured || !Array.isArray(j.answers)) break;
      for (const a of j.answers) answers[a.id] = a;
    }
    if (Object.keys(answers).length === Object.keys(known).length) return Object.keys(known).length ? known : null;
    save(key, answers);
    return answers;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}
