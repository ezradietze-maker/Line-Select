import type { ReportTime } from "@/types/bidpack";

/**
 * Trade board data model.
 *
 * This board is a coordination tool only — see the disclaimer shown on the
 * Trade Board page itself. Nothing here represents a real, legal schedule
 * trade; that still has to go through FedEx's actual trade process, which
 * checks rest rules, qualifications, and currency this app has no way to
 * verify.
 *
 * The unit of trade is a single trip (pairing), not a whole line — that's
 * what pilots actually swap with each other once bidding closes.
 */

export type TradeOfferStatus = "open" | "pending" | "accepted" | "declined" | "withdrawn";

/** A snapshot of one trip's key stats at the moment it was offered — not a live link to anyone's bid pack. */
export interface TripSnapshot {
  /** Which of the offering pilot's own lines this trip currently lives on — context for the other pilot, not something they can act on directly. */
  lineNumber: string;
  /** The trip's own pairing number as printed in the bid pack (e.g. "13") — how a pilot actually recognizes a specific trip, since the same pairing can recur across many lines. Null for an estimated trip with no confirmed pairing. */
  pairingNumber: string | null;
  days: number;
  layoverCities: string[];
  international: boolean;
  reportTime: ReportTime;
  creditHours: number;
  tafbHours: number;
  landings: number;
  deadheadLegs: number;
}

export interface BidPackMetaSnapshot {
  base: string;
  aircraft: string;
  seat: string;
  month: string;
}

export interface TradeOffer {
  id: string;
  bidPackMeta: BidPackMetaSnapshot;
  offeringUserId: string;
  offeringDisplayName: string;
  offeredTrip: TripSnapshot;
  /** A specific pairing number the offering pilot wants back, or null if open to any offer. */
  wantedPairingNumber: string | null;
  note: string | null;
  status: TradeOfferStatus;
  createdAt: string;
  responderUserId: string | null;
  responderDisplayName: string | null;
  responderTrip: TripSnapshot | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  /**
   * Client-only, never sent to or stored on the server: a synthetic offer
   * generated locally so the accept flow has something to interact with
   * before real pilots are using the board. Always shown with a visible
   * "Demo" label so it's never mistaken for a real pilot's offer.
   */
  isDemo?: boolean;
}
