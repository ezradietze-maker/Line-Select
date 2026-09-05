import type { CitySentiment, ExplicitTargetKey, PreferenceWeights } from "@/types/preferences";

/**
 * The adaptive interview's own data shapes — a turn-by-turn transcript plus
 * a running, continuously re-derived structured profile, as distinct from
 * the legacy static interview's fixed `PreferenceWeights` slider walk. See
 * `src/lib/interview-engine.ts` for the pure functions that build/reduce
 * these, and the plan at the top of this project's interview work for why
 * "measurable" is a closed, code-backed catalog rather than anything an LLM
 * can invent live.
 */

/** How a measurable fact actually plugs into scoring — `direction`/`value` mirror the sign convention `scoring.ts`/`rank-learning.ts` already use per key type (bipolar -100..100, magnitude-only 0..100, or implicit -1.5..1.5). */
export type MeasurableBinding =
  | { type: "explicit-weight"; key: keyof PreferenceWeights; direction: 1 | -1 }
  | { type: "explicit-target"; key: ExplicitTargetKey; value: number }
  | { type: "implicit-weight"; variableId: string; direction: 1 | -1 }
  | { type: "city-sentiment"; code: string; sentiment: CitySentiment };

export type FactSource =
  | { kind: "seed-question"; questionKey: string }
  | { kind: "adaptive-question"; questionId: string };

export interface PreferenceFact {
  /** Client-generated (crypto.randomUUID()). */
  id: string;
  /** Plain-English, pilot-voice: "Wants to avoid back-to-back red-eyes, especially on international trips." Shown verbatim on the results screen for qualitative facts — write it as finished copy, not a label. */
  statement: string;
  kind: "measurable" | "qualitative";
  /** Only ever present when kind === "measurable" — see MeasurableBinding's own doc comment for why a fact with no honest computable backing can never have one of these, no matter how confidently it was stated. */
  measurable?: MeasurableBinding;
  /** 0-1: how sure the extraction step is that this fact is real, as opposed to a stretch inferred from a throwaway remark. */
  confidence: number;
  /** 0-1: how strongly the pilot seems to feel about it, independent of confidence — a pilot can be very sure about something they only mildly care about. */
  importance: number;
  source: FactSource;
  /** Which turn in interviewTranscript this was learned or last revised on. */
  turnIndex: number;
}

/** What the LLM (or a seed question, replayed through the same machinery) asks. `kind` discriminates how the client renders it — every non-free-text kind is bound to a real, existing catalog slot via `boundTo`, never an invented one. */
export type InterviewQuestion =
  | {
      id: string;
      kind: "slider";
      prompt: string;
      helpText?: string;
      lowLabel: string;
      highLabel: string;
      centerLabel: string;
      boundTo: keyof PreferenceWeights;
    }
  | {
      id: string;
      kind: "target-slider";
      prompt: string;
      helpText?: string;
      unitSingular: string;
      unitPlural: string;
      boundTo: ExplicitTargetKey;
    }
  | { id: string; kind: "choice"; prompt: string; helpText?: string; options: { label: string; description?: string }[] }
  | { id: string; kind: "free-text"; prompt: string; helpText?: string; placeholder?: string }
  | { id: string; kind: "wrap-up"; prompt: string };

export type InterviewAnswer =
  | { kind: "slider"; value: number }
  | { kind: "target-slider"; value: number | undefined }
  | { kind: "choice"; selectedIndex: number }
  | { kind: "free-text"; text: string }
  | { kind: "skipped" };

export interface InterviewTurnRecord {
  turnIndex: number;
  question: InterviewQuestion;
  answer: InterviewAnswer;
  /** Which PreferenceFact.id's this turn's answer created or revised, for traceability from a fact back to the exchange that produced it. */
  profileFactIdsTouched: string[];
}

/** One delta the LLM asks the client to apply to the running fact list — additive by default, but a later answer can revise or retract an earlier inference as the picture sharpens. */
export type PreferenceFactUpdate =
  | { op: "add"; fact: PreferenceFact }
  | { op: "revise"; fact: PreferenceFact }
  | { op: "retire"; factId: string };

/** Real, bid-pack-derived numbers used to ground a question the same way the legacy interview's `sliderExtraFor` stat callouts already do — see `src/lib/interview-grounding.ts`. */
export interface BidPackGroundingStats {
  tripLength: { min: number; max: number } | null;
  reportTime: { earliest: string; latest: string } | null;
  creditHours: { min: number; max: number };
  deadheadTripSharePercent: number | null;
  distinctHotelCount: number;
  distinctCityCount: number;
}

/** What the client sends the turn-loop route each turn. */
export interface TurnRequestBody {
  transcript: InterviewTurnRecord[];
  facts: PreferenceFact[];
  grounding: BidPackGroundingStats;
  base: string;
  aircraft: string;
  isCommuter: boolean | null;
  turnsUsed: number;
  softCapTurns: number;
  hardCeilingTurns: number;
}

/** What the route returns — one Anthropic call handles both "what to ask next" and "what to extract from the last answer," per turn. */
export interface TurnResponse {
  action: "ask" | "wrap_up";
  /** Null iff action === "wrap_up". */
  question: InterviewQuestion | null;
  /** Deltas from the pilot's last answer — empty on turn 1, when there's nothing yet to extract from. */
  profileUpdates: PreferenceFactUpdate[];
  /** Internal-only rationale for this turn's choice, logged for debugging/pilot-review transcripts — never shown to the pilot. */
  reasoning?: string;
}
