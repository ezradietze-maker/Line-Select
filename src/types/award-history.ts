import type { Seat } from "@/types/bidpack";

/**
 * A pilot's own report of what they actually held after a bid cycle closed,
 * tied to their seniority at the time — the raw material for a real,
 * FedEx-specific hold-rate history that doesn't exist anywhere else (every
 * competitor's "odds" feature is built on a different airline's award data).
 * No pilot id, name, or email is stored. What other pilots see is only the
 * numbers needed to bucket a future pilot's own line by base/aircraft/seat
 * and seniority. Server-side, a record is also tagged with a one-way hash of
 * the reporter's account (never returned by any listing) so their own months
 * form a private hold history and the forecast they were shown can be
 * checked against what they got — see `lib/learning/hold-history.ts`.
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
};
