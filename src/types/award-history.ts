import type { Seat } from "@/types/bidpack";

/**
 * A pilot's own report of what they actually held after a bid cycle closed,
 * tied to their seniority at the time — the raw material for a real,
 * FedEx-specific hold-rate history that doesn't exist anywhere else (every
 * competitor's "odds" feature is built on a different airline's award data).
 * Deliberately anonymous: no pilot id, name, or email is stored, only the
 * numbers needed to bucket a future pilot's own line by base/aircraft/seat
 * and seniority. Posting requires sign-in (an anti-spam gate, matching the
 * rest of this app's server-write routes) but the record itself carries no
 * link back to who submitted it.
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

export type AwardHistorySubmission = Omit<AwardHistoryRecord, "id" | "submittedAt">;
