import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tradeDeadlineHours, tripInstanceKey, tripSpan } from "@/lib/trades/legality";
import type { PilotHolding } from "@/lib/trades/match";
import type { BidPack, Trip } from "@/types/bidpack";
import type { BidPackMetaSnapshot, TradeOffer, TripSnapshot } from "@/types/trade";

/** What says which trip a snapshot is. */
type TripNamed = Pick<TripSnapshot, "tripId" | "startDayIndex" | "pairingNumber" | "lineNumber">;

/** A trip one pilot gives away. */
export interface GivenTrip {
  pilot: string;
  trip: TripSnapshot;
}

/** The trip on its day, as `tripInstanceKey` names it; null for an offer posted before snapshots carried the date. */
export function snapshotTripKey(trip: Pick<TripSnapshot, "tripId" | "startDayIndex">): string | null {
  if (!trip.tripId || trip.startDayIndex === undefined || trip.startDayIndex === null) return null;
  return tripInstanceKey({ id: trip.tripId, startDayIndex: trip.startDayIndex });
}

/**
 * Whether two snapshots are the same trip on the same day. One posted before the date was kept can't say which day it
 * meant, so the same pairing from the same line is taken to be the same trip: freeing one offer too many is better
 * than letting one trip be agreed with two pilots.
 */
export function sameTrip(a: TripNamed, b: TripNamed): boolean {
  const ka = snapshotTripKey(a);
  const kb = snapshotTripKey(b);
  if (ka && kb) return ka === kb;
  return a.pairingNumber !== null && a.pairingNumber === b.pairingNumber && a.lineNumber === b.lineNumber;
}

const sameMeta = (a: BidPackMetaSnapshot, b: BidPackMetaSnapshot) =>
  a.base === b.base && a.aircraft === b.aircraft && a.seat === b.seat && a.month === b.month;

const HOUR = 3_600_000;

/**
 * Whether a trip on the board is past its trade deadline (`tradeDeadlineHours`, CBA 2026 25.L.9.a.ii), as suggested
 * trades already are (`isTradeable`): the board had none, so a trip that had shown, or flown, could still be offered,
 * proposed and agreed. The show is the one in `pack` when it's this seat's month and has the trip; otherwise the first
 * minute of the day the trip starts, in the base's time, which is never after its show (a pilot told too early is never
 * late). A trip whose day isn't known can't be judged, and passes.
 */
export function pastTradeDeadline(pack: BidPack | null, meta: BidPackMetaSnapshot, trip: TripSnapshot, now: number): boolean {
  const deadline = tradeDeadlineHours(meta) * HOUR;
  const key = snapshotTripKey(trip);
  const found = pack && key && sameMeta(pack, meta) ? pack.lines.flatMap((l) => l.trips).find((t) => tripInstanceKey(t) === key) : undefined;
  const span = pack && found ? tripSpan(pack, found) : null;
  if (span) return span.start - deadline <= now;
  if (!trip.date) return false;
  const day = DateTime.fromISO(trip.date, { zone: timezoneForAirport(meta.base) ?? "UTC" }).startOf("day");
  return day.isValid && day.toMillis() - deadline <= now;
}

/** What each pilot on an offer gives away in it: the offering pilot their trip, and a proposing pilot theirs. */
function tripsGivenIn(offer: TradeOffer): GivenTrip[] {
  const given: GivenTrip[] = [{ pilot: offer.offeringUserId, trip: offer.offeredTrip }];
  if (offer.responderUserId && offer.responderTrip) given.push({ pilot: offer.responderUserId, trip: offer.responderTrip });
  return given;
}

/**
 * Whether this pilot has already agreed to trade this trip away, in one of `offers` from the same seat's month. Freeing
 * the other offers at the moment of an accept (`offersFreedByTrade`) isn't enough on its own: an offer posted, or a
 * proposal made, with the trip afterwards would let it be agreed with a second pilot.
 */
export function alreadyTraded(offers: readonly TradeOffer[], meta: BidPackMetaSnapshot, pilot: string, trip: TripSnapshot): boolean {
  return offers.some((o) => o.status === "accepted" && sameMeta(o.bidPackMeta, meta) && tripsGivenIn(o).some((g) => g.pilot === pilot && sameTrip(g.trip, trip)));
}

/**
 * Once a trade is agreed, both its trips are spoken for. The pilots' other offers of those trips are withdrawn, and a
 * proposal either of them made with one on someone else's offer is taken off it, leaving that offer open again for
 * other pilots. Without this one trip could be agreed with two pilots.
 */
export function offersFreedByTrade(accepted: TradeOffer, others: readonly TradeOffer[]): { withdraw: string[]; reopen: string[] } {
  return offersFreedBy(tripsGivenIn(accepted), accepted.bidPackMeta, others.filter((o) => o.id !== accepted.id));
}

/**
 * The same for trips that changed hands some other way, as a step of a suggested trade: an offer of one is withdrawn,
 * and a proposal made with one is taken off, or the board could agree a trip its pilot no longer has.
 */
export function offersFreedBy(gone: readonly GivenTrip[], meta: BidPackMetaSnapshot, others: readonly TradeOffer[]): { withdraw: string[]; reopen: string[] } {
  const withdraw: string[] = [];
  const reopen: string[] = [];
  for (const o of others) {
    if ((o.status !== "open" && o.status !== "pending") || !sameMeta(o.bidPackMeta, meta)) continue;
    if (gone.some((g) => g.pilot === o.offeringUserId && sameTrip(g.trip, o.offeredTrip))) withdraw.push(o.id);
    else if (o.status === "pending" && o.responderTrip && gone.some((g) => g.pilot === o.responderUserId && sameTrip(g.trip, o.responderTrip!))) reopen.push(o.id);
  }
  return { withdraw, reopen };
}

/** The trips the board's agreed trades give away, and who gives each. */
export function agreedBoardTrips(offers: readonly TradeOffer[]): GivenTrip[] {
  return offers.filter((o) => o.status === "accepted").flatMap(tripsGivenIn);
}

/**
 * These pilots, with the trips they agreed to trade on the board locked: they're spoken for, so no suggested trade may
 * hand them on, though the pilot holds them until the trade goes through. An offer posted before snapshots carried the
 * date names only its pairing, so every one of the pilot's trips on that pairing is held back.
 */
export function lockBoardTrades(pilots: readonly PilotHolding[], given: readonly GivenTrip[]): PilotHolding[] {
  if (!given.length) return [...pilots];
  return pilots.map((p) => {
    const mine = given.filter((g) => g.pilot === p.pilotId);
    if (!mine.length) return p;
    const spoken = p.line.trips.filter((t) => mine.some((g) => isSnapshotOf(g.trip, t)));
    if (!spoken.length) return p;
    return { ...p, locked: new Set([...(p.locked ?? []), ...spoken.map(tripInstanceKey)]) };
  });
}

/** Whether a held trip is the one a snapshot names; for an older offer that didn't say which day, any day of the pairing. */
function isSnapshotOf(snapshot: TripSnapshot, trip: Trip): boolean {
  const key = snapshotTripKey(snapshot);
  return key ? key === tripInstanceKey(trip) : snapshot.pairingNumber !== null && snapshot.pairingNumber === trip.pairingNumber;
}

/** One pilot's side of a trade agreed on the board: the trip they take, and the one they give for it, if they give one. */
export interface BoardSwap {
  pilot: string;
  give: TripSnapshot | null;
  take: TripSnapshot;
}

/** What each pilot takes in the board's agreed trades, with what they give for it. */
export function agreedBoardSwaps(offers: readonly TradeOffer[]): BoardSwap[] {
  return offers.flatMap((o) => {
    if (o.status !== "accepted" || !o.responderUserId) return [];
    const swaps: BoardSwap[] = [{ pilot: o.responderUserId, give: o.responderTrip, take: o.offeredTrip }];
    if (o.responderTrip) swaps.push({ pilot: o.offeringUserId, give: o.offeredTrip, take: o.responderTrip });
    return swaps;
  });
}

/**
 * These pilots, with what they take in the board's agreed trades that haven't gone through yet (`PilotHolding.agreed`):
 * a trip a suggested trade hands them must fit beside it too, or two trades each legal alone leave them holding two
 * that aren't. Gone through is when the trip they gave is off what they hold (they've confirmed since). A pilot taking a
 * trip this pack can't place can't be checked, so isn't matched until they confirm what they hold.
 */
export function withBoardSwaps(pack: Pick<BidPack, "lines">, pilots: readonly PilotHolding[], swaps: readonly BoardSwap[]): PilotHolding[] {
  if (!swaps.length) return [...pilots];
  const inPack = new Map(pack.lines.flatMap((l) => l.trips.map((t) => [tripInstanceKey(t), t] as const)));
  return pilots.flatMap((p) => {
    const mine = swaps.filter((s) => s.pilot === p.pilotId);
    if (!mine.length) return [p];
    const have = new Set(p.line.trips.map(tripInstanceKey));
    const gives = new Set<string>();
    const takes: Trip[] = [];
    for (const s of mine) {
      const giving = s.give ? p.line.trips.filter((t) => isSnapshotOf(s.give!, t)) : [];
      if (s.give && !giving.length) continue;
      const key = snapshotTripKey(s.take);
      const take = key ? inPack.get(key) : undefined;
      if (!take) return [];
      if (have.has(key!)) continue;
      for (const t of giving) gives.add(tripInstanceKey(t));
      takes.push(take);
    }
    return takes.length ? [{ ...p, agreed: { gives, takes } }] : [p];
  });
}
