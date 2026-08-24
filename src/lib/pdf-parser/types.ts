import type { BidPack } from "@/types/bidpack";

/** Which of the two page types we actually parse, or why a page was skipped. */
export type PageKind =
  | "pairing-schedule"
  | "line-grid"
  | "ignored-personal-data" // vacation / seniority / training rosters — never parsed
  | "ignored-other"; // cover, TOC, info, sweep flights, reserve lines, etc.

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
