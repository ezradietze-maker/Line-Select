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

/**
 * Why a pilot can't trade a trip. CBA 2026 25.L.1.h "may not trade, proffer, or drop a trip assigned as VLT, DRF, AVA,
 * CMU, PDO, PMU, or RSV"; 25.L.1.c a trip scheduled for a check ride; 8.x.b a trip with a deviated deadhead inside 14 days.
 */
export type TradeLock = "VLT" | "DRF" | "AVA" | "CMU" | "PDO" | "PMU" | "RSV" | "checkRide" | "deviation";

/** One trip a pilot holds: which trip on which date in their bid pack, and why they can't trade it, if they can't. */
export interface HeldTrip {
  id: string;
  startDayIndex: number;
  lock: TradeLock | null;
}

/** What a pilot has confirmed they hold in one bid pack. */
export interface TradeHolding {
  packId: string;
  bidPackMeta: BidPackMetaSnapshot;
  /** The line these trips started from; null once they no longer came from one line. */
  lineNumber: string | null;
  trips: HeldTrip[];
  confirmedAt: string;
}

export interface TradeSettings {
  /** On unless the pilot turns it off: whether they're included when trades are worked out. */
  suggestMe: boolean;
  /** Off unless the pilot turns it on: an email when a suggested trade needs their answer. */
  emailMatches: boolean;
}
