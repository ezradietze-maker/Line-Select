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
  /**
   * Real UTC instant (ISO 8601) for this leg's departure/arrival, anchored
   * to the trip's own `zuluAnchor` — this is what the Zulu/Local toggle
   * actually converts (via each airport's IANA zone), since the printed
   * `depTimeGmt`/`arrTimeGmt` HHMM strings above have no date attached and
   * can't tell a westbound date-line day-gain from an ordinary midnight
   * rollover on their own.
   */
  depTimeZulu: string;
  arrTimeZulu: string;
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
  /**
   * A synthetic-but-internally-consistent UTC instant this trip's Zulu
   * clock is anchored to — real month/year (from the bid pack) so DST
   * behaves correctly at every airport the trip touches, but the exact
   * day-of-month isn't tracked per trip instance (the bid pack ties a
   * pairing to a line, not to one specific calendar date within the bid
   * month), so this and everything derived from it show relative "Day N"
   * labels rather than a specific calendar date. Empty string when the
   * trip has no verified schedule to anchor (same cases `schedule` is
   * empty for).
   */
  zuluAnchor: string;
  /**
   * 0-indexed offset from `BidPack.bidPeriodStart` for the calendar day this
   * trip actually starts on within its line — real, read from the line-grid
   * page's own per-day columns (see `lib/pdf-parser/line-grid-days.ts`), not
   * inferred. Null when it couldn't be confidently read (an estimated line,
   * a bid pack whose grid didn't match the expected layout, or a mismatch
   * between the grid's own trip count and this line's matched pairings) —
   * a whole line's trips are placed together or not at all, since a
   * partially-real calendar would look authoritative while quietly being
   * wrong for some of its trips.
   */
  startDayIndex: number | null;
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

/**
 * One reserve line's on-call type, read straight from its own row on the
 * bid pack's "Reserve Lines" grid — never from a page listing who's actually
 * on it. `null` means the row's printed letters were mixed or absent on the
 * visible portion of the grid, not that the line has no type; nothing here
 * is ever inferred or guessed at when the printed grid doesn't say.
 */
export interface ReserveLine {
  /** Reserve line number as published, e.g. "7014". */
  lineNumber: string;
  /** "24hr" = the pack's own "R (24-Hr)" type; "a"/"b" = its "RA"/"RB" types, whatever those specifically cover isn't printed on the grid itself. */
  reserveType: "24hr" | "a" | "b" | null;
}

/**
 * The per-seat summary numbers printed on a bid pack's own "Bid Information"
 * page — real guarantees and averages, not computed from the parsed lines.
 * Any field the page didn't print in a recognized format is `null` rather
 * than estimated.
 */
export interface BidPackInfo {
  /** Reserve Line Guarantee: hours a reserve pilot is paid regardless of whether they're called out. */
  rlgHours: number | null;
  /** Hours credited per scheduled reserve day toward that guarantee. */
  rDayValueHours: number | null;
  lowLineCreditHours: number | null;
  highLineCreditHours: number | null;
  averageDaysOff: number | null;
  totalRegularLines: number | null;
  totalReserveLines: number | null;
  totalSecondaryLines: number | null;
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
  /**
   * The bid period's real first calendar day (e.g. "2026-08-31"), read from
   * the line-grid page's own printed date range — the anchor `Trip.
   * startDayIndex` is an offset against. Null when the PDF's line-grid
   * header didn't match the expected format, in which case every trip's
   * `startDayIndex` is null too and the month calendar falls back to a
   * sequential, non-dated layout.
   */
  bidPeriodStart: string | null;
  lines: Line[];
  /** Absent when this bid pack's PDF had no recognizable Reserve Lines grid for this seat, or none was uploaded. */
  reserveLines?: ReserveLine[];
  /** Absent when this bid pack's PDF had no recognizable "Bid Information" page. */
  info?: BidPackInfo;
}
