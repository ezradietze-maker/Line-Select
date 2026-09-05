/**
 * A fact the adaptive interview's extraction step judged real and worth
 * tracking, but that doesn't cleanly bind to anything in the existing
 * measurable catalog (`PreferenceWeights`, `ExplicitTargetKey`,
 * `IMPLICIT_VARIABLES`) — logged for later human/dev review, the same
 * spirit as `CandidateVariable` (`src/types/candidate-variable.ts`) but
 * without that type's drag-correction-specific required fields
 * (`favoredLineNumber`/`overtakenLineNumber`), which have no meaning for an
 * interview-turn fact, and with an optional `pilotId` since the interview
 * is guest-accessible and most facts will have no signed-in pilot behind
 * them at all.
 */
export interface InterviewCandidateFact {
  id: string;
  pilotId: string | null;
  /** The pilot's own words (or the LLM's paraphrase of a slider/choice answer) that produced this fact. */
  rawStatement: string;
  proposedName: string;
  proposedDescription: string;
  createdAt: string;
}
