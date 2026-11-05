import type { TradeOffer } from "@/types/trade";

/** What another pilot's account id reads as. The screens only ever compare an id with the viewer's own. */
export const ANOTHER_PILOT = "another-pilot";

/**
 * A trade offer as one signed-in pilot may see it: their own account id where it's theirs, and a placeholder for
 * anyone else's, so no pilot's internal id ever leaves the server. Names, trips and status are unchanged.
 */
export function offerForViewer(offer: TradeOffer, viewerId: string): TradeOffer {
  const own = (id: string | null) => (id === null ? null : id === viewerId ? id : ANOTHER_PILOT);
  return { ...offer, offeringUserId: own(offer.offeringUserId) ?? ANOTHER_PILOT, responderUserId: own(offer.responderUserId) };
}
