/**
 * Core data model for a bid pack: a set of monthly flight-schedule "lines"
 * for one base / aircraft / seat combination. Mirrors the structure of a
 * real pairing bid pack (report times, layovers, block/credit/TAFB, deadhead
 * legs) but in a normalized, JSON-friendly shape instead of the fixed-width
 * text real bid packs are published in.
 */

export type ReportTime = "early" | "afternoon" | "evening";

export type Seat = "CAP" | "FO";

export interface TripLayover {
  city: string;
  /** The specific hotel assigned for this layover, as printed in the pairing schedule — null when none was printed (e.g. an estimated trip, or a stop with no overnight hotel). */
  hotelName: string | null;
}

export interface Trip {
  id: string;
  /** Number of calendar days the trip spans, report to release. */
  days: number;
  /** Layover cities in order, IATA-style codes (excludes home base). */
  layoverCities: string[];
  /** Same layovers as `layoverCities`, in visit order, each with its assigned hotel. */
  layoverDetails: TripLayover[];
  reportTime: ReportTime;
  international: boolean;
  /** Count of deadhead (non-flying, repositioning) legs in the trip. */
  deadheadLegs: number;
  /** Credit hours earned for this trip. */
  creditHours: number;
  /** Landings flown during the trip (not counting deadhead legs). */
  landings: number;
  /** Time away from base for this trip, in hours. */
  tafbHours: number;
}

export interface Line {
  id: string;
  /** Bid line number as published, e.g. "1091". */
  lineNumber: string;
  trips: Trip[];
  /** Scheduled days off in the bid period (not flying or deadheading). */
  daysOff: number;
  /** Sum of trip credit hours for the whole line. */
  totalCreditHours: number;
  /** Sum of trip TAFB hours for the whole line. */
  totalTafbHours: number;
  /** Sum of trip landings for the whole line. */
  totalLandings: number;
  /**
   * True when `trips` isn't a verified breakdown — e.g. a parsed bid pack
   * line whose calendar entries couldn't be confidently matched to a
   * specific pairing. daysOff/totalCreditHours/totalTafbHours/totalLandings
   * are still exact (read straight from the source), but `trips` is a
   * single stand-in built from those totals, so anything derived from
   * per-trip shape (length, international mix, report time, deadhead
   * count) is a rough estimate rather than a verified fact.
   */
  estimated?: boolean;
}

export interface BidPack {
  id: string;
  /** e.g. "SEP26" */
  month: string;
  base: string;
  aircraft: string;
  seat: Seat;
  /** Length of the bid period in days, e.g. 28 for a 4-week bidmonth. */
  bidPeriodDays: number;
  lines: Line[];
}
