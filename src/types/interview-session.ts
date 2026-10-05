import type {
  CitySentiment,
  DeepSliderKey,
  ExplicitTargetKey,
  QuickQuestionKey,
} from "@/types/preferences";

/**
 * Every real key that can carry a directional -100..100 (or 0..100
 * magnitude-only) lean — deliberately excludes "departures", which is
 * target-only (see `ExplicitTargetKey`) and has no directional form.
 * "riskTolerance"/"adminEffortAppetite" are appended directly here rather
 * than folded into `DeepSliderKey` — that union's own name and every
 * existing member is a legacy-static-interview-consumed slider key, and
 * these two are adaptive-interview-only, strategy-board inputs (see their
 * doc comments in `types/preferences.ts`) with no equivalent in that older
 * flow.
 */
export type ExplicitWeightKey = QuickQuestionKey | DeepSliderKey | "riskTolerance" | "adminEffortAppetite";

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
  | { kind: "adaptive-question"; questionId: string }
  /** The pilot set this directly on the Preferences or confirmation screen instead of answering an interview question — see `lib/profile-edits.ts`. */
  | { kind: "manual-edit" };

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
  /**
   * Absent for a fact that has only ever existed in one bid cycle (the
   * overwhelming majority, including every fact in a pilot's very first
   * interview). Present once `finalizeAdaptiveProfile` has matched this
   * fact's binding against a prior cycle's profile — see
   * `interview-engine.ts`'s `foldCycleHistory`. `lastCycleId` is that prior
   * profile's own `completedAt`, reused as a cheap, already-unique cycle
   * identifier rather than inventing a separate counter.
   */
  cycleHistory?: {
    /** How many completed cycles (including this one) have produced a fact for this same binding identity. */
    cycleCount: number;
    lastCycleId: string;
    /** Resets to 0 the moment a cycle's binding actually disagrees with the previous one — see `bindingsAgree`. A high count means "reaffirmed the same conclusion repeatedly," not just "existed a long time." */
    reaffirmedCount: number;
  };
  /**
   * True once a fact's binding has disagreed with its own prior-cycle value
   * at least once (see `cycleHistory.reaffirmedCount` resetting to 0) —
   * distinct from a single one-off disagreement, this is the sticky flag the
   * interview prompt reads to keep re-checking a preference that's shown
   * real cycle-to-cycle drift, rather than treating it as settled the way a
   * `reaffirmedCount >= 2` fact is treated.
   */
  volatile?: boolean;
  /**
   * Set only on a qualitative fact that's specifically the "why" behind a
   * city-sentiment pick (the city-preferences topic's mandatory follow-up —
   * see `interview-topics.ts`). Not a `MeasurableBinding`: this never feeds
   * scoring, it's a structured tag so the results screen can reliably tie a
   * "why" statement back to a real city and, when the reason is hotel-
   * related, surface that city's actual review summary — without resorting
   * to fragile text-matching on the statement's own prose the way
   * `qualitativeTieInsForLine` (`scoring.ts`) has to for everything else.
   */
  cityReason?: {
    code: string;
    category: "weather" | "people" | "hotel" | "layover-length" | "downtime" | "other";
  };
  /**
   * Set only on a qualitative fact describing a recurring, day-of-week-
   * shaped personal commitment (coaching practice every Tuesday, a standing
   * weekly appointment). Not a `MeasurableBinding` — no dimension or slider
   * of its own — but the results screen checks it against each line's real
   * calendar (`lib/line-month.ts`'s `weekdayFlyingPattern`), flags a genuine
   * conflict, and lowers that line's score (`commitmentPenalty` in `scoring.ts`).
   */
  recurringWeekday?: WeekdayAbbreviation;
  /**
   * The one-off counterpart: real calendar dates ("2026-10-14") a qualitative
   * fact needs off — a wedding, a checkride, a kid's recital. Checked the same
   * way against each line's real calendar (`workingDayIndices`), flagged, and
   * likewise lowers a conflicting line's score. Dates outside the bid period
   * are kept on the fact but can't be checked against any line.
   */
  specificDates?: string[];
}

export type WeekdayAbbreviation = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

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
  | { id: string; kind: "free-text"; prompt: string; helpText?: string; placeholder?: string };

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
  /**
   * Real hotel-standby numbers for this pack (days sitting on call at a layover hotel, paid, not flying) — grounds the hotel-standby topic, and is how the interview knows whether to raise it at all. Absent on a request from before standby was tracked.
   */
  hotelStandby?: {
    /** Lines (of the verified ones) with at least one standby day. 0 means the pack has none and the topic must not be raised. */
    linesWithStandby: number;
    verifiedLines: number;
    /** Most standby days on any single line. */
    maxDaysOnALine: number;
    /** Most consecutive standby days inside any single trip. */
    longestStretchDays: number;
    /** Most separate trips with standby on any single line. */
    maxStintsOnALine: number;
    /** The guaranteed credit hours a standby day pays (the pack's own printed figure, usually 3:12). */
    creditHoursPerStandbyDay: number | null;
  };
  /** Null when this bid pack's PDF had no recognizable Reserve Lines grid at all — grounds the reserve-tolerance topic with real numbers rather than a vague "does this pack have reserve lines" guess. */
  reserveLines: { count: number; typeBreakdown: Partial<Record<"24hr" | "a" | "b", number>> } | null;
  /*
   * Everything below is absent on a request from a client built before it
   * existed — the prompt treats a missing field as "not known", never as 0.
   */
  /** The real per-line spread of days off — often narrow (13-16 on a real pack), which is exactly what a days-off target question needs to know. */
  daysOff?: { min: number; max: number };
  /** The real per-line spread of printed duty periods ("NO. DP'S"). */
  dutyPeriods?: { min: number; max: number };
  /** The bid period's real dates, so "the 14th" or "Halloween weekend" can be pinned to a day. Null when the pack's grid header didn't give a start date. */
  bidPeriod?: { start: string; end: string; days: number } | null;
  /** What a day off actually costs in this pack: average credit of the lines at each days-off count — the real numbers behind a "would you give up N hours for M more days home" trade. */
  creditByDaysOff?: { daysOff: number; lines: number; avgCreditHours: number }[];
  /** Share of lines with at least one international trip. */
  internationalLineSharePercent?: number | null;
  /** The pack's layover cities, most-visited first (top 40), with how many trips lay over in each — the codes a city named mid-interview has to bind to. */
  layoverCities?: { code: string; trips: number }[];
  /** Spread of each line's longest run of consecutive days off (`longestDaysOffBlockPerLine`). Null when the pack has no grid day-off marks. */
  daysOffBlock?: { min: number; max: number } | null;
  /** Spread of Saturdays + Sundays off per line (`weekendDaysOffPerLine`), and how many weekend days the period has. Null when the pack has no grid day-off marks or start date. */
  weekendDaysOff?: { min: number; max: number; weekendDaysInPeriod: number } | null;
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
  /**
   * Explicit-weight ids (see `interview-engine.ts`'s `EXPLICIT_WEIGHT_IDS`)
   * with zero engagement so far this cycle, recomputed fresh each turn from
   * `facts` — a concrete, checkable gap list handed to the model every turn
   * rather than a paragraph of "remember to check the catalog" prose it has
   * to re-derive from memory. See `uncoveredExplicitWeightIds`'s own doc
   * comment for the live-testing failure this exists to close.
   */
  uncoveredExplicitWeightIds: string[];
  /**
   * Facts from the pilot's prior bid-cycle profile they explicitly flagged
   * as "something's changed" on the returning-pilot check screen (see
   * `ReturningPilotCheckStep.tsx`) — deliberately never folded into `facts`
   * itself, since they're stated as no longer accurate. Given to the model
   * so it asks what changed in its own voice instead of the thread just
   * silently disappearing. Absent for a first-time interview, or a
   * returning one where nothing was flagged.
   */
  priorFactsChanged?: PreferenceFact[];
  /**
   * Free-text (or a quick-tag label) the pilot gave on the returning-pilot
   * check screen — "moved," "new baby," etc. Reprioritizes what the model
   * chooses to re-open this cycle toward the topics that flag actually
   * implicates, rather than leaving that connection to be inferred later.
   * Absent for a first-time interview or when nothing was flagged.
   */
  lifeEvent?: string;
  /**
   * Set for exactly one turn request: a contradiction between the pilot's
   * most recent answer and a prior-cycle fact was just detected client-side
   * (see `detectContradiction` in `interview-engine.ts`). The model is told
   * to ask about this directly on this turn, in its own voice, before
   * moving to fresh ground — surfacing it as signal, not silently
   * overwriting or silently keeping the old fact.
   */
  contradictionFlag?: { newStatement: string; priorStatement: string };
  /**
   * The pilot's own unedited answer to the bidding-story question (see
   * `BiddingStoryStep.tsx`), threaded into every later turn so the model
   * keeps writing in a voice that matches this specific pilot's own words
   * for the whole interview, not just the one extraction pass that read it.
   * Absent when the pilot skipped that question.
   */
  bidStory?: string;
  /**
   * A small, rotating sample of anonymized phrase snippets pulled from many
   * pilots' own bidding-story answers (see `server/style-store.ts`) — loose
   * calibration for vocabulary/register across the whole pilot population,
   * never quoted back verbatim. Empty until enough pilots have answered the
   * story question to have anything to sample from.
   */
  styleSample?: string[];
}

/** What the client sends the one-shot bidding-story extraction call — see `runBiddingStoryExtraction` in `interview-turn-service.ts`. No transcript/facts yet: this runs before the adaptive loop exists. */
export interface BiddingStoryRequestBody {
  bidStoryText: string;
  grounding: BidPackGroundingStats;
  base: string;
  aircraft: string;
  isCommuter: boolean | null;
  /** This bid pack's real layover city codes, most-visited first (see `rankLayoverCitiesByFrequency` in `scoring.ts`) — lets the model confidently bind a pilot-named city ("I love Paris layovers") to a real city-sentiment fact instead of leaving it an untied qualitative statement, the one thing this extraction couldn't do without knowing which codes are real. */
  cityCodes: string[];
}

/** What the bidding-story extraction call returns — every fact it could pull out of the narrative, plus anonymized style material the route stores server-side (never returned past that). */
export interface BiddingStoryResponse {
  profileUpdates: PreferenceFactUpdate[];
  /** Short, scrubbed phrases capturing how this pilot writes — never full sentences from the actual answer, never anything identifying. Stored anonymously; not shown to this or any pilot. */
  styleSamplePhrases: string[];
  /** A few loose style descriptors (e.g. "terse", "dry humor") describing the same thing, redundantly, for cheap future filtering. */
  styleTags: string[];
  /** Whether the story says this pilot commutes in (true), lives in base (false), or doesn't say (null) — pre-fills the commuter step, which the pilot still confirms. */
  commuterStatus: boolean | null;
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
