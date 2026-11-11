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
  /** The line these trips started from, if they did. */
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

export type TradeAnswer = "waiting" | "accepted" | "declined";
export type TradeSuggestionStatus = "proposed" | "accepted" | "cancelled" | "done";
/** Why a pilot said no, if they said: what shapes what they're offered next. */
export type TradeDeclineReason = "trip" | "notWorthIt" | "notNow" | "wrongHolding";

/**
 * A pilot said no; or someone's trips changed or their account went, so the trade no longer stands; or not everyone
 * answered in time (`ANSWER_DAYS`), and those who did are free for other trades.
 */
export type TradeCancelReason = "declined" | "changed" | "unanswered";

/** One priority a trade moves, as a pilot would read it. */
export interface TradeReason {
  label: string;
  from: number | null;
  to: number | null;
  unit: string;
  better: boolean;
}

/** What a trade does for one pilot. Theirs alone: it's never shown to the others on the trade. */
export interface TradeValue {
  gain: number;
  before: number;
  after: number;
  creditChange: number;
  daysOffChange: number;
  reasons: TradeReason[];
}

/** A trip on a suggested trade: which one, what it looks like, and the date it flies (YYYY-MM-DD). */
export interface TradeTrip extends TripSnapshot {
  id: string;
  startDayIndex: number;
  date: string | null;
}

/** One pilot on a suggested trade. They give their trip to the pilot before them and take the next pilot's. */
export interface TradeSuggestionMember {
  userId: string;
  displayName: string;
  position: number;
  give: TradeTrip;
  value: TradeValue;
  answer: TradeAnswer;
}

export interface TradeSuggestionRecord {
  id: string;
  packId: string;
  bidPackMeta: BidPackMetaSnapshot;
  status: TradeSuggestionStatus;
  cancelReason: TradeCancelReason | null;
  /** The two-pilot trades to make, in order, by position. */
  steps: { a: number; b: number }[];
  /** How many of the steps are done; always the first ones. */
  stepsDone: number;
  expiresAt: string;
  createdAt: string;
  members: TradeSuggestionMember[];
}

/** A trade step as one pilot on it reads it. */
export interface TradeStepView {
  pilotA: string;
  pilotB: string;
  /** What each hands over at this step, which in a chain may be a trip they only just received. */
  aGives: TradeTrip;
  bGives: TradeTrip;
  done: boolean;
  /** This pilot is one of the two. */
  yours: boolean;
  /** Which of the two this pilot is: by position, as names are free text and two pilots can share one. */
  youAreA: boolean;
  youAreB: boolean;
  /** The next step to do, and this pilot can mark it done. */
  canMarkDone: boolean;
  /** What this pilot holds after this step, when they're in it. */
  youHoldAfter: TradeTrip | null;
}

/** A suggested trade as one pilot may see it: no other pilot's account id, and no other pilot's reasons or score. */
export interface TradeSuggestionView {
  id: string;
  status: TradeSuggestionStatus | "expired";
  cancelReason: TradeCancelReason | null;
  size: number;
  expiresAt: string;
  createdAt: string;
  you: { give: TradeTrip; take: TradeTrip; value: TradeValue; answer: TradeAnswer };
  pilots: { name: string; isYou: boolean; gives: TradeTrip; accepted: boolean }[];
  steps: TradeStepView[];
  /** Before real-time trade processing starts, a chain's later trades may have to wait for its earlier ones. */
  slowChainWarning: boolean;
}
