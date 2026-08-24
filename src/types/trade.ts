/**
 * Trade board data model.
 *
 * This board is a coordination tool only — see the disclaimer shown on the
 * Trade Board page itself. Nothing here represents a real, legal schedule
 * trade; that still has to go through FedEx's actual trade process, which
 * checks rest rules, qualifications, and currency this app has no way to
 * verify.
 */

export type TradeOfferStatus = "open" | "pending" | "accepted" | "declined" | "withdrawn";

/** A snapshot of a line's key stats at the moment it was offered — not a live link to anyone's bid pack. */
export interface LineSnapshot {
  lineNumber: string;
  daysOff: number;
  totalCreditHours: number;
  totalTafbHours: number;
  totalLandings: number;
  tripCount: number;
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
  offeredLine: LineSnapshot;
  /** A specific line number the offering pilot wants back, or null if open to any offer. */
  wantedLineNumber: string | null;
  note: string | null;
  status: TradeOfferStatus;
  createdAt: string;
  responderUserId: string | null;
  responderDisplayName: string | null;
  responderLine: LineSnapshot | null;
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
