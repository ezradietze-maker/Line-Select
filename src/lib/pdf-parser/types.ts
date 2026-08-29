import type { BidPack } from "@/types/bidpack";

/** Which page types we actually parse, or why a page was skipped. */
export type PageKind =
  | "pairing-schedule"
  | "line-grid"
  | "reserve-line-grid"
  | "info-page"
  | "ignored-personal-data" // vacation / seniority / training rosters — never parsed
  | "ignored-other"; // cover, TOC, sweep flights, etc.

export interface PageClassification {
  pageNumber: number;
  kind: PageKind;
  /** Short reason, e.g. the header text that triggered this classification. */
  reason: string;
}

export interface ParseWarning {
  pageNumber: number;
  message: string;
  /** A short excerpt of the offending text, for debugging — never personal data. */
  context?: string;
}

export interface LayoverDetail {
  city: string;
  /** The specific hotel printed for this layover, e.g. "WHITE SWAN" — null when the pairing schedule didn't print one for this stop. */
  hotelName: string | null;
}

/**
 * One flight leg exactly as printed in the pairing schedule — real departure
 * and arrival clock times, not estimated. `startMinutes`/`endMinutes` are
 * elapsed minutes since the pairing's own first report time (t=0), derived
 * by walking every printed GMT clock reading in order and adding a day
 * whenever a reading is earlier than the one before it — never guessed, and
 * self-consistent with the leg's own printed block time.
 */
export interface ScheduledLeg {
  flightNumber: string;
  /** "JET" for an interline/generic airframe, or the operator's own fleet code (e.g. "76") for a company-operated leg. */
  equipment: string;
  /** True when the pilot is riding along rather than operating — either an interline flight number, or the pairing schedule's own "DH" flag on an otherwise company-operated leg (a repositioning ride on their own metal). */
  isDeadhead: boolean;
  depAirport: string;
  /** "HHMM", local time as printed — what a pilot would actually read on the schedule. */
  depTimeLocal: string;
  /** "HHMM", GMT as printed alongside the local time — kept so a real UTC offset (and therefore timezone deltas, direction of travel, circadian positioning) can be derived without guessing, not just displayed. */
  depTimeGmt: string;
  arrAirport: string;
  arrTimeLocal: string;
  arrTimeGmt: string;
  /** Null on the rare row where the schedule didn't print a block time. */
  blockHours: number | null;
  startMinutes: number;
  endMinutes: number;
}

/** A report-to-layover stretch of a pairing: one or more legs, then (unless it's the pairing's last) a real, printed-duration rest period. */
export interface ScheduledDutyPeriod {
  /** "HHMM", local time as printed. */
  reportTimeLocal: string;
  startMinutes: number;
  legs: ScheduledLeg[];
  /** Null for the pairing's final duty period, which ends the trip rather than laying over. */
  layover: {
    city: string;
    hotelName: string | null;
    /** Ground-transport company for the airport->hotel ride right after landing, e.g. "BESPOKE TRANSPORTATION" — printed on the pairing's own "Trans To:" line. Null when that line wasn't found (e.g. an older parse, or the row didn't match). */
    transportToHotel: string | null;
    /** The same ride the other direction — hotel->airport, before the next departure — from the "Trans From:" line. */
    transportFromHotel: string | null;
    /** Hours exactly as printed on the schedule (e.g. "LAX 28:43") — authoritative, not computed from the surrounding clock times. */
    hours: number;
    startMinutes: number;
    endMinutes: number;
  } | null;
}

export interface ParsedPairing {
  id: string;
  sequenceNumber: string;
  pageNumber: number;
  days: number;
  layoverCities: string[];
  /** Same layovers as `layoverCities`, in visit order, each paired with its assigned hotel. */
  layoverDetails: LayoverDetail[];
  reportTime: "early" | "afternoon" | "evening";
  reportTimeLocal: string;
  international: boolean;
  deadheadLegs: number;
  creditHours: number;
  blockHours: number;
  landings: number;
  tafbHours: number;
  /** Raw effective-date text, e.g. "SEPTEMBER 4 - SEPTEMBER 11". Kept for trip matching. */
  effectiveText: string;
  /** First leg's flight number, used to match this pairing to line-grid day cells. */
  firstFlightNumber: string;
  /** All flight numbers appearing in this pairing, in order. */
  flightNumbers: string[];
  /**
   * The full report/fly/layover schedule, minute-by-minute from real printed
   * data — powers the per-trip visual timeline. Empty when the schedule
   * couldn't be confidently broken into duty periods (falls back to the
   * summary-only fields above, same honesty policy as an estimated line).
   */
  schedule: ScheduledDutyPeriod[];
}

export interface ParsedLineSummary {
  lineNumber: string;
  pageNumber: number;
  seat: "CAP" | "FO";
  daysOff: number;
  totalCreditHours: number;
  totalTafbHours: number;
  totalLandings: number;
  numDutyPeriods: number;
  /** Flight numbers found in this line's calendar cells, in date order, for trip matching. */
  flightNumberSequence: string[];
}

export interface BidPackMeta {
  month: string;
  base: string;
  aircraft: string;
  seat: "CAP" | "FO";
}

export interface ParseBidPackResult {
  /** One bid pack per seat found in the PDF (a bid pack usually contains both CAP and F/O line grids). */
  bidPacksBySeat: Partial<Record<"CAP" | "FO", BidPack>>;
  meta: BidPackMeta | null;
  pageClassifications: PageClassification[];
  pairingsParsed: number;
  linesParsed: number;
  /** lineNumber -> seat, for lines whose trips could not be confidently matched to a specific pairing. */
  linesWithIncompleteTrips: { lineNumber: string; seat: "CAP" | "FO" }[];
  warnings: ParseWarning[];
  errors: ParseWarning[];
  /** True if extracted text looked garbled (e.g. a scanned/image-only PDF). */
  looksLikeScannedPdf: boolean;
}
