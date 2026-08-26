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

/** One flight leg exactly as printed in the pairing schedule. `startMinutes`/`endMinutes` are elapsed minutes since the trip's own first report time (t=0) — real clock times, not estimated. */
export interface TripLeg {
  flightNumber: string;
  /** "JET" for an interline/generic airframe, or the operator's own fleet code (e.g. "76") for a company-operated leg. */
  equipment: string;
  /** True when the pilot is riding along rather than operating. */
  isDeadhead: boolean;
  depAirport: string;
  /** "HHMM", local time as printed. */
  depTimeLocal: string;
  /** "HHMM", GMT as printed alongside the local time — the raw material for a real per-airport UTC offset, not a displayed field on its own. */
  depTimeGmt: string;
  arrAirport: string;
  arrTimeLocal: string;
  arrTimeGmt: string;
  /** Null on the rare row where the schedule didn't print a block time. */
  blockHours: number | null;
  startMinutes: number;
  endMinutes: number;
}

/** A report-to-layover stretch of a trip: one or more legs, then (unless it's the trip's last) a real, printed-duration rest period. */
export interface TripDutyPeriod {
  /** "HHMM", local time as printed. */
  reportTimeLocal: string;
  startMinutes: number;
  legs: TripLeg[];
  /** Null for the trip's final duty period, which ends the trip rather than laying over. */
  layover: {
    city: string;
    hotelName: string | null;
    /** Ground-transport company for the airport->hotel ride right after landing, from the pairing's own "Trans To:" line. Null when not printed or not found. */
    transportToHotel: string | null;
    /** The same ride back to the airport before the next departure, from "Trans From:". */
    transportFromHotel: string | null;
    /** Hours exactly as printed on the schedule — authoritative, not computed. */
    hours: number;
    startMinutes: number;
    endMinutes: number;
  } | null;
}

export interface Trip {
  id: string;
  /** The pairing's own printed sequence number (e.g. "13") — how pilots actually refer to a specific trip on the trade board, since the same pairing recurs across many lines. Null for an estimated trip, which isn't tied to one real, identifiable pairing. */
  pairingNumber: string | null;
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
  /** Number of separate duty periods (report-to-release stretches) in this trip — the real count of times a pilot leaves home for this trip, distinct from `days`, since several short duty periods can be bundled into one multi-day trip. */
  departures: number;
  /**
   * The full report/fly/layover schedule, minute-by-minute from real printed
   * data — powers the per-trip visual timeline. Empty when the schedule
   * couldn't be confidently broken into duty periods, or the trip is
   * estimated — the same honesty policy as `Line.estimated`.
   */
  schedule: TripDutyPeriod[];
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
  /** Sum of trip departures for the whole line. */
  totalDepartures: number;
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
