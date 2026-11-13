import type { Seat } from "@/types/bidpack";

/**
 * A pilot's own report of what they actually held after a bid cycle closed,
 * tied to their seniority at the time — the raw material for a real,
 * FedEx-specific hold-rate history that doesn't exist anywhere else (every
 * competitor's "odds" feature is built on a different airline's award data).
 * No pilot id, name, or email is stored. Server-side, a record is tagged with a
 * keyed one-way hash of the reporter's account (never returned by anything) so
 * their own months form a private hold history, they can withdraw it, and the
 * forecast they were shown can be checked against what they got — see
 * `lib/learning/hold-history.ts`. Single records never leave the server: other
 * pilots see group numbers (`AwardBand`), and "held by" only for pilots who
 * agreed to it (`HeldByView`), both behind `lib/server/award-aggregate.ts`.
 */
export interface AwardHistoryRecord {
  id: string;
  base: string;
  aircraft: string;
  seat: Seat;
  /** Bid pack month as printed, e.g. "SEP26" — self-reported, not verified against a real pack. */
  month: string;
  seniorityRank: number;
  seniorityTotalPilots: number;
  outcome: "line" | "reserve" | "other";
  /** Only meaningful when outcome is "line" — the real computed shape of the line the pilot said they held, not a guess. */
  lineNumber: string | null;
  daysOff: number | null;
  totalCreditHours: number | null;
  totalTafbHours: number | null;
  submittedAt: string;
}

export type AwardHistorySubmission = Omit<AwardHistoryRecord, "id" | "submittedAt"> & {
  /** Where the held line sat in this pilot's own ranking (1 = their top line) — never shown to anyone else. */
  awardedChoice?: number | null;
  /** After the month: how it flew against what they expected. The real-outcome signal (`lib/learning/outcome-score.ts`). */
  monthFeel?: import("./logbook").MonthFeel | null;
  /** The pilot agreed to "Held by seniority #N" beside this line, and `seniorityRank` was read exactly from the pack's list. */
  holderShown?: boolean;
  /** Which brain version ranked the pilot's lines, and whether fleet notes were in its prompt — so outcomes can be compared by both. */
  brainVersion?: number | null;
  notesUsed?: boolean | null;
};

/** Group numbers for one fixed slice of a seat's seniority list. The averages stay null until enough different pilots stand behind them. */
export interface AwardBand {
  /** About how many reports fall in this slice, across every month: to the nearest 5, and 0 until enough different pilots have reported. */
  reports: number;
  avgDaysOff: number | null;
  avgCreditHours: number | null;
  lineRate: number | null;
}

/** All a client ever gets from the public listing: one entry per slice, most senior first. */
export interface AwardSummaryResponse {
  totalReports: number;
  bands: AwardBand[];
}

/** One line's holder, from a pilot who agreed to show it. The browser turns the bid position into a seniority number using the pack's own list. */
export interface HeldByEntry {
  lineNumber: string;
  bidPosition: number;
}

/** What a signed-in pilot sees for one pack: nothing until enough pilots have agreed to show what they held. */
export interface HeldByView {
  holders: HeldByEntry[];
  /** How many shared awards the odds in use have been checked against, once a correction has passed its fair test. */
  oddsCheckedAgainst: number | null;
}
