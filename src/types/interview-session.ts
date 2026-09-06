import type {
  CitySentiment,
  DeepSliderKey,
  ExplicitTargetKey,
  QuickQuestionKey,
} from "@/types/preferences";

/** Every real key that can carry a directional -100..100 (or 0..100 magnitude-only) lean — deliberately excludes "departures", which is target-only (see `ExplicitTargetKey`) and has no directional form. */
export type ExplicitWeightKey = QuickQuestionKey | DeepSliderKey;

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
  | { type: "explicit-weight"; key: ExplicitWeightKey; direction: 1 | -1 }
  | {
      type: "explicit-target";
      key: ExplicitTargetKey;
      value: number;
      /**
       * Absent (or `"ideal"`) means exactly what it always has — a single
       * pinned number. `"min"`/`"max"` mark this fact as one piece of a
       * tolerance band instead — only meaningful for `daysOff`/`departures`
       * (see `RangeTarget` in `types/preferences.ts`); `finalizeAdaptiveProfile`
       * merges facts sharing a key into one `RangeTarget` rather than the
       * usual last-write-wins. Each role is its own fact/turn, captured via
       * up to three separate `target-slider` questions (a floor question,
       * an ideal question, a ceiling question) — no new UI widget needed.
       */
      rangeRole?: "min" | "ideal" | "max";
    }
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
  /**
   * Absent for the overwhelming majority of facts — a normal soft preference,
   * folded into the continuous weighted average like everything else.
   * `"dealbreaker"` means the pilot's own words were unambiguous about
   * refusal ("I will not," "that's a dealbreaker"), not just a strongly-worded
   * preference ("I really don't like") — see `interview-prompt.ts`'s guidance
   * on this distinction. Scoring caps (rather than dilutes) a line's index
   * when a dealbreaker is violated — see `scoring.ts`'s
   * `applyDealbreakerViolations`. Meaningful on `"explicit-weight"`,
   * `"implicit-weight"`, and `"city-sentiment"` bindings always; on an
   * `"explicit-target"` binding only when `rangeRole` is `"min"` or `"max"`
   * — a stated floor or ceiling has a real violation condition (falling
   * below it / exceeding it) a bare pinned "ideal" number doesn't, so
   * severity is dropped rather than honored when `rangeRole` is absent or
   * `"ideal"` (see `parseProfileUpdates` in `interview-turn-service.ts`).
   */
  severity?: "dealbreaker";
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
      boundTo: ExplicitWeightKey;
    }
  | {
      id: string;
      kind: "target-slider";
      prompt: string;
      helpText?: string;
      unitSingular: string;
      unitPlural: string;
      boundTo: ExplicitTargetKey;
      /** Mirrors `MeasurableBinding`'s explicit-target `rangeRole` — which part of a tolerance band this specific question is asking about. Absent/"ideal" behaves exactly as before. */
      rangeRole?: "min" | "ideal" | "max";
    }
  | { id: string; kind: "choice"; prompt: string; helpText?: string; options: { label: string; description?: string }[] }
  | { id: string; kind: "free-text"; prompt: string; helpText?: string; placeholder?: string }
  | { id: string; kind: "wrap-up"; prompt: string };

export type InterviewAnswer =
  /** `elaboration`: optional free-text the pilot chose to add alongside a slider answer — always offered in the adaptive loop, never required. Read by the same extraction step that reads the slider value itself. */
  | { kind: "slider"; value: number; elaboration?: string }
  | { kind: "target-slider"; value: number | undefined; elaboration?: string }
  | { kind: "choice"; selectedIndex: number; elaboration?: string }
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
  /** Real per-line landings span — grounds the landings-preference topic the same way creditHours/tripLength are already grounded. */
  landings: { min: number; max: number };
  /** Null when this bid pack's PDF had no recognizable Reserve Lines grid at all — grounds the reserve-tolerance topic with real numbers rather than a vague "does this pack have reserve lines" guess. */
  reserveLines: { count: number; typeBreakdown: Partial<Record<"24hr" | "a" | "b", number>> } | null;
}

/** What the client sends the turn-loop route each turn. */
export interface TurnRequestBody {
  transcript: InterviewTurnRecord[];
  facts: PreferenceFact[];
  grounding: BidPackGroundingStats;
  base: string;
  aircraft: string;
  isCommuter: boolean | null;
  /**
   * Running turn counter, zeroed at the true start of the interview (right
   * after the one-off commuter toggle) — used both as each new fact's
   * `turnIndex` and as the budget number sent to the model / compared
   * against softCapTurns/hardCeilingTurns. These used to be two separate
   * fields (`turnsUsed` vs `adaptiveTurnsUsed`) back when a deterministic
   * seed round ran before the adaptive loop and needed excluding from the
   * model's own budget framing — with no more seed phase, turn 0 of the
   * loop really is turn 0, so the split no longer means anything.
   */
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
