import type { TravelNeed } from "@/lib/flights/needs";
import { distanceKm } from "@/lib/metrics/home-travel";

/**
 * Counting the real ways to make each trip: from airline departure boards,
 * every itinerary (nonstop, or one connection) that leaves inside a need's
 * window and gets there in time — or, going home, the first one home. For a
 * commuter, the count is the safety margin: one to plan on, and the rest are
 * backups if it cancels.
 */

export interface ScheduledFlight {
  /** Flight number, "AS 608". */
  n: string;
  from: string;
  to: string;
  /** Epoch ms, scheduled. */
  dep: number;
  arr: number;
  /** A FedEx flight from the bid pack, ridden on the jumpseat (see `jumpseat.ts`). */
  jumpseat?: true;
}

export interface TravelAnswer {
  id: string;
  tripId: string;
  kind: TravelNeed["kind"];
  /** Distinct ways to go: each a different flight into the destination that can be reached in time (nonstop or connecting). */
  options: number;
  /** How many of the ways ride a FedEx flight on the jumpseat. */
  jumpseatWays: number;
  /** When you'd leave for each way (its latest feeder getting somewhere, earliest going home), epoch ms, earliest first. */
  departures: number[];
  /** Getting somewhere: the last departure that still makes it. */
  lastDeparture: number | null;
  /** Going home: the first arrival home. */
  firstArrival: number | null;
  /** The quickest itinerary that works, for showing ("SAN 06:15 → SEA → ANC 12:40"). */
  best: ScheduledFlight[] | null;
  /** The window that was searched (epoch ms) — going home with no options, he's waiting at least until its end. */
  window: [number, number];
}

/** A connection needs at least this long on the ground. */
export const MIN_CONNECTION_MS = 60 * 60_000;
/** Between an airline and a FedEx flight: out of the terminal and across to the FedEx ramp, or back. */
export const JUMPSEAT_CONNECTION_MS = 2 * 60 * 60_000;

const connectionMs = (a: ScheduledFlight, b: ScheduledFlight) => (!!a.jumpseat !== !!b.jumpseat ? JUMPSEAT_CONNECTION_MS : MIN_CONNECTION_MS);

/** Airports worth looking through for a connection — big connecting hubs, so lookups stay few and the connections real. */
export const CONNECTING_HUBS = new Set([
  "SEA",
  "PDX",
  "SFO",
  "LAX",
  "SAN",
  "LAS",
  "PHX",
  "SLC",
  "DEN",
  "DFW",
  "IAH",
  "MSP",
  "ORD",
  "DTW",
  "ATL",
  "CLT",
  "MIA",
  "MCO",
  "EWR",
  "JFK",
  "LGA",
  "BOS",
  "IAD",
  "PHL",
  "BWI",
  "BNA",
  "STL",
  "MCI",
  "AUS",
  "ANC",
  "HNL",
  "YVR",
  "YYC",
  "YYZ",
  "YUL",
  "HKG",
  "NRT",
  "HND",
  "ICN",
  "TPE",
  "SIN",
  "PVG",
  "PEK",
  "BKK",
  "KUL",
  "MNL",
  "CDG",
  "FRA",
  "AMS",
  "LHR",
  "MUC",
  "IST",
  "DXB",
  "DOH",
  "ZRH",
  "MAD",
  "FCO",
  "SYD",
  "AKL",
  "MEX",
]);

export type Boards = (airport: string) => ScheduledFlight[] | undefined;

/** A connection that adds more than this share of distance isn't one anybody would book. */
const MAX_DETOUR = 1.3;

/** Whether connecting at `hub` is on the way from `from` to `to` (unknown coordinates count as on the way). */
function onTheWay(from: string, hub: string, to: string): boolean {
  const direct = distanceKm(from, to);
  const a = distanceKm(from, hub);
  const b = distanceKm(hub, to);
  return direct === null || a === null || b === null || a + b <= direct * MAX_DETOUR;
}

/**
 * The connecting airports worth fetching for a need: hubs its origins fly to inside the window that are on the way, the
 * ones nearest where it's going first — the last leg is the scarce one, and a gateway near the destination (Seattle for
 * Anchorage) has the most flights onward. FedEx gateways the origins' FedEx flights reach come on top, never in place
 * of an airline hub.
 */
export function hubsFor(need: TravelNeed, boards: Boards, max = 3, maxGateways = 2): string[] {
  const airline = new Set<string>();
  const company = new Set<string>();
  for (const origin of need.from)
    for (const f of boards(origin) ?? [])
      if (
        f.dep >= need.departAfter &&
        f.dep <= need.departBefore &&
        !need.to.includes(f.to) &&
        !need.from.includes(f.to) &&
        need.to.some((dest) => onTheWay(origin, f.to, dest))
      ) {
        if (f.jumpseat) company.add(f.to);
        else if (CONNECTING_HUBS.has(f.to)) airline.add(f.to);
      }
  const toDest = (hub: string) => Math.min(...need.to.map((d) => distanceKm(hub, d) ?? Infinity));
  const hubs = [...airline].sort((a, b) => toDest(a) - toDest(b)).slice(0, max);
  const gateways = [...company].filter((h) => !hubs.includes(h)).sort((a, b) => toDest(a) - toDest(b)).slice(0, maxGateways);
  return [...hubs, ...gateways];
}

export function answerNeed(need: TravelNeed, boards: Boards): TravelAnswer | null {
  const firsts: ScheduledFlight[] = [];
  for (const origin of need.from) {
    const board = boards(origin);
    if (!board) return null;
    for (const f of board) if (f.from === origin && f.dep >= need.departAfter && f.dep <= need.departBefore) firsts.push(f);
  }
  const arrives = (f: ScheduledFlight) => need.arriveBy === undefined || f.arr <= need.arriveBy;
  const itineraries: ScheduledFlight[][] = [];
  for (const f of firsts) {
    if (need.to.includes(f.to)) {
      if (arrives(f)) itineraries.push([f]);
      continue;
    }
    const onward = boards(f.to);
    if (!onward) continue;
    // The quickest onward connection that still makes it.
    const next = onward
      .filter((g) => g.from === f.to && need.to.includes(g.to) && g.dep >= f.arr + connectionMs(f, g) && arrives(g))
      .sort((a, b) => a.arr - b.arr)[0];
    if (next) itineraries.push([f, next]);
  }
  // A way to go is a flight into the destination: if it cancels, every feeder into it goes with it. Getting somewhere,
  // each keeps the latest feeder that reaches it (the one you'd take); going home, the earliest.
  const byFinal = new Map<string, ScheduledFlight[]>();
  for (const it of itineraries) {
    const last = it.at(-1)!;
    const key = `${last.from}|${last.dep}|${last.to}`;
    const prev = byFinal.get(key);
    if (!prev || (need.arriveBy !== undefined ? it[0].dep > prev[0].dep : it[0].dep < prev[0].dep)) byFinal.set(key, it);
  }
  const options = [...byFinal.values()];
  const best = itineraries.length ? [...itineraries].sort((a, b) => a.at(-1)!.arr - a[0].dep - (b.at(-1)!.arr - b[0].dep))[0] : null;
  return {
    id: need.id,
    tripId: need.tripId,
    kind: need.kind,
    options: options.length,
    jumpseatWays: options.filter((o) => o.some((f) => f.jumpseat)).length,
    departures: options.map((o) => o[0].dep).sort((a, b) => a - b),
    lastDeparture: need.arriveBy !== undefined && options.length ? Math.max(...options.map((o) => o[0].dep)) : null,
    firstArrival: need.arriveBy === undefined && options.length ? Math.min(...options.map((o) => o.at(-1)!.arr)) : null,
    best,
    window: [need.departAfter, need.departBefore],
  };
}

/** A commute is planned within a day's travel: flights much earlier than the last one that works aren't anybody's backup. */
export const BACKUP_SPAN_MS = 12 * 3_600_000;

/**
 * Backups: getting somewhere, the flights that still make it after the one you'd plan on, counted within a day's travel
 * of the last one that works; going home, every way beyond the first.
 */
export function backupsOf(a: TravelAnswer): number {
  if (a.lastDeparture === null || !a.departures) return Math.max(0, a.options - 1);
  const from = a.lastDeparture - BACKUP_SPAN_MS;
  return Math.max(0, a.departures.filter((d) => d >= from).length - 1);
}
