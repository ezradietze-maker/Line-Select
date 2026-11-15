import { offerStillTradeable } from "@/lib/trades/offer-trips";
import type { BidPack } from "@/types/bidpack";
import type { TradeOffer } from "@/types/trade";

export function sameBidPack(offer: TradeOffer, bidPack: BidPack): boolean {
  return (
    offer.bidPackMeta.base === bidPack.base &&
    offer.bidPackMeta.aircraft === bidPack.aircraft &&
    offer.bidPackMeta.seat === bidPack.seat &&
    offer.bidPackMeta.month === bidPack.month
  );
}

export interface InboxSections {
  /** Someone proposed a counter-trip on one of your own offers — needs your accept/decline. */
  needsResponse: TradeOffer[];
  /** Someone else's open offer specifically asks for a pairing you currently have posted. */
  directInterest: TradeOffer[];
  /** One of your trades, as offeror or responder, that reached agreement. */
  accepted: TradeOffer[];
}

/**
 * What the Inbox badge, its seen marks and the toasts know an offer by. A proposal is the offer and when it was made:
 * one taken off (its trip was traded elsewhere) leaves the offer open, and the next pilot's proposal on it is new,
 * though the offer's id is the same. Kept by id alone, it was already "seen" and never counted or toasted.
 */
export function inboxNoticeKey(offer: Pick<TradeOffer, "id" | "status" | "respondedAt">): string {
  return offer.status === "pending" && offer.respondedAt ? `${offer.id}@${offer.respondedAt}` : offer.id;
}

/** How many of these the Inbox badge counts: those not yet seen (`inboxNoticeKey`). */
export function unseenCount(offers: readonly TradeOffer[], seen: ReadonlySet<string>): number {
  return offers.filter((o) => !seen.has(inboxNoticeKey(o))).length;
}

/**
 * With `deadline`, an offer past its trade deadline (`offerStillTradeable`) is left out of what needs an answer, as the
 * board leaves it off: nothing can be agreed on it any more, yet it counted on the badge and sent the pilot to the
 * board for an offer the board didn't show.
 */
export function computeInboxSections(offers: TradeOffer[], userId: string | undefined, deadline?: { pack: BidPack | null; now: number }): InboxSections {
  const live = (o: TradeOffer) => !deadline || offerStillTradeable(deadline.pack, o, deadline.now);
  const needsResponse = offers.filter(
    (o) => o.status === "pending" && o.offeringUserId === userId && live(o)
  );

  const myOpenPairingNumbers = new Set(
    offers
      .filter((o) => o.offeringUserId === userId && (o.status === "open" || o.status === "pending") && live(o))
      .map((o) => o.offeredTrip.pairingNumber)
      .filter((n): n is string => n !== null)
  );
  const directInterest = offers.filter(
    (o) =>
      o.offeringUserId !== userId &&
      o.status === "open" &&
      live(o) &&
      o.wantedPairingNumber &&
      myOpenPairingNumbers.has(o.wantedPairingNumber)
  );

  const accepted = offers.filter(
    (o) => (o.offeringUserId === userId || o.responderUserId === userId) && o.status === "accepted"
  );

  return { needsResponse, directInterest, accepted };
}
