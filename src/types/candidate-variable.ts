/**
 * A pilot's free-text explanation for a drag-and-drop correction that the
 * classifier couldn't confidently map onto an existing taxonomy variable —
 * stored verbatim rather than force-fit or discarded (Section 5.4). Nothing
 * here is inferred beyond what the pilot actually typed: the "proposed"
 * name/description come from the classifier's read of their own words, not
 * an invented category.
 */
export interface CandidateVariable {
  id: string;
  pilotId: string;
  /** The pilot's own words, unedited. */
  rawQuote: string;
  /** A short name/description the classifier proposed for what this quote seems to describe — a starting point for review, not a confirmed taxonomy entry. */
  proposedName: string;
  proposedDescription: string;
  favoredLineNumber: string;
  overtakenLineNumber: string;
  createdAt: string;
}
