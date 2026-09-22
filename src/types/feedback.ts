/**
 * A pilot's own words about the app, sent from anywhere in the product via
 * the "Send feedback" entry point in the sidebar — the one thing a beta
 * cohort is actually for. Submittable as a guest (feedback shouldn't
 * require an account); `pilotId`/`pilotEmail` are filled in when the
 * sender happens to be signed in, null otherwise.
 */
export type FeedbackCategory = "bug" | "idea" | "confusing" | "other";

export interface FeedbackSubmission {
  id: string;
  pilotId: string | null;
  pilotDisplayName: string | null;
  pilotEmail: string | null;
  category: FeedbackCategory;
  message: string;
  /** Path the pilot was on when they opened the form, e.g. "/results" — context for reading the message later, not user tracking. */
  page: string;
  createdAt: string;
}
