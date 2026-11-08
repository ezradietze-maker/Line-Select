import type { Seat } from "@/types/bidpack";

/** How a flown month compared with what the pilot expected when they bid it. */
export type MonthFeel = "better" | "asExpected" | "worse";

/** A trip of a logged line that runs past the month's end: what next month's carry-in needs (`lib/phase-in.ts`). */
export interface CarriedTrip {
  label: string;
  /** ISO instants. */
  report: string;
  release: string;
  international: boolean;
  creditHours: number;
  duties: { start: string; end: string }[];
}

/**
 * One month in a pilot's logbook: the award they got, a picture of the line as flown (kept with the entry, since the
 * pack itself is replaced next month), and — after the month — how it flew. Kept in the pilot's own profile; shared
 * only when they say so, and then only anonymously (see `/api/award-history`).
 */
export interface LoggedMonth {
  id: string;
  /** The bid pack it came from, when it was logged from one. */
  bidPackId?: string;
  base: string;
  aircraft: string;
  seat: Seat;
  /** Bid month as the pack prints it ("OCT26"). */
  month: string;
  outcome: "line" | "reserve" | "other";
  /** For a line: its number and its shape. */
  lineNumber?: string | null;
  creditHours?: number | null;
  daysOff?: number | null;
  tafbHours?: number | null;
  tripCount?: number | null;
  /** Layover cities, one entry per layover. */
  layoverCities?: string[];
  /** Trips of the held line that run into next month. The pack is replaced, so the entry keeps them. */
  carryOut?: CarriedTrip[];
  /** Where the held line sat in the pilot's own ranking (1 = their top line). */
  rankedAt?: number | null;
  seniorityRank?: number | null;
  seniorityTotalPilots?: number | null;
  loggedAt: string;
  /** When it was shared anonymously, if it was. */
  sharedAt?: string;
  /** After the month: how it flew. */
  checkIn?: { feel: MonthFeel; bestTrip?: string; worstTrip?: string; note?: string; at: string };
}
