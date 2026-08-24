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
  /** Someone proposed a counter-line on one of your own offers — needs your accept/decline. */
  needsResponse: TradeOffer[];
  /** Someone else's open offer specifically asks for a line you currently have posted. */
  directInterest: TradeOffer[];
  /** One of your trades, as offeror or responder, that reached agreement. */
  accepted: TradeOffer[];
}

export function computeInboxSections(offers: TradeOffer[], userId: string | undefined): InboxSections {
  const needsResponse = offers.filter(
    (o) => o.status === "pending" && o.offeringUserId === userId
  );

  const myOpenLineNumbers = new Set(
    offers
      .filter((o) => o.offeringUserId === userId && (o.status === "open" || o.status === "pending"))
      .map((o) => o.offeredLine.lineNumber)
  );
  const directInterest = offers.filter(
    (o) =>
      o.offeringUserId !== userId &&
      o.status === "open" &&
      o.wantedLineNumber &&
      myOpenLineNumbers.has(o.wantedLineNumber)
  );

  const accepted = offers.filter(
    (o) => (o.offeringUserId === userId || o.responderUserId === userId) && o.status === "accepted"
  );

  return { needsResponse, directInterest, accepted };
}
