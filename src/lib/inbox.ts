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

export function computeInboxSections(offers: TradeOffer[], userId: string | undefined): InboxSections {
  const needsResponse = offers.filter(
    (o) => o.status === "pending" && o.offeringUserId === userId
  );

  const myOpenPairingNumbers = new Set(
    offers
      .filter((o) => o.offeringUserId === userId && (o.status === "open" || o.status === "pending"))
      .map((o) => o.offeredTrip.pairingNumber)
      .filter((n): n is string => n !== null)
  );
  const directInterest = offers.filter(
    (o) =>
      o.offeringUserId !== userId &&
      o.status === "open" &&
      o.wantedPairingNumber &&
      myOpenPairingNumbers.has(o.wantedPairingNumber)
  );

  const accepted = offers.filter(
    (o) => (o.offeringUserId === userId || o.responderUserId === userId) && o.status === "accepted"
  );

  return { needsResponse, directInterest, accepted };
}
