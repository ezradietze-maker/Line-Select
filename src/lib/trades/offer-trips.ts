import { tripInstanceKey } from "@/lib/trades/legality";
import type { BidPackMetaSnapshot, TradeOffer, TripSnapshot } from "@/types/trade";

/** The trip on its day, as `tripInstanceKey` names it; null for an offer posted before snapshots carried the date. */
export function snapshotTripKey(trip: TripSnapshot): string | null {
  if (!trip.tripId || trip.startDayIndex === undefined || trip.startDayIndex === null) return null;
  return tripInstanceKey({ id: trip.tripId, startDayIndex: trip.startDayIndex });
}

/**
 * Whether two snapshots are the same trip on the same day. One posted before the date was kept can't say which day it
 * meant, so the same pairing from the same line is taken to be the same trip: freeing one offer too many is better
 * than letting one trip be agreed with two pilots.
 */
export function sameTrip(a: TripSnapshot, b: TripSnapshot): boolean {
  const ka = snapshotTripKey(a);
  const kb = snapshotTripKey(b);
  if (ka && kb) return ka === kb;
  return a.pairingNumber !== null && a.pairingNumber === b.pairingNumber && a.lineNumber === b.lineNumber;
}

const sameMeta = (a: BidPackMetaSnapshot, b: BidPackMetaSnapshot) =>
  a.base === b.base && a.aircraft === b.aircraft && a.seat === b.seat && a.month === b.month;

/** What each pilot on an offer gives away in it: the offering pilot their trip, and a proposing pilot theirs. */
function tripsGivenIn(offer: TradeOffer): { pilot: string; trip: TripSnapshot }[] {
  const given = [{ pilot: offer.offeringUserId, trip: offer.offeredTrip }];
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
  const gone = tripsGivenIn(accepted);
  const withdraw: string[] = [];
  const reopen: string[] = [];
  for (const o of others) {
    if (o.id === accepted.id || (o.status !== "open" && o.status !== "pending") || !sameMeta(o.bidPackMeta, accepted.bidPackMeta)) continue;
    if (gone.some((g) => g.pilot === o.offeringUserId && sameTrip(g.trip, o.offeredTrip))) withdraw.push(o.id);
    else if (o.status === "pending" && o.responderTrip && gone.some((g) => g.pilot === o.responderUserId && sameTrip(g.trip, o.responderTrip!))) reopen.push(o.id);
  }
  return { withdraw, reopen };
}
