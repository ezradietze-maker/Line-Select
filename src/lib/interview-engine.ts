import { INTERVIEW_TOPIC_BACKLOG } from "@/lib/interview-topics";
import { emptyWeights } from "@/lib/preference-logic";
import { MAGNITUDE_ONLY_KEYS } from "@/lib/rank-learning";
import type {
  BidPackGroundingStats,
  ExplicitWeightKey,
  InterviewAnswer,
  InterviewQuestion,
  InterviewTurnRecord,
  MeasurableBinding,
  PreferenceFact,
  PreferenceFactUpdate,
  TurnRequestBody,
} from "@/types/interview-session";
import type { CitySentiment, ExplicitTargetKey, PreferenceProfile, RangeTarget } from "@/types/preferences";

/**
 * Pure functions only — no `fetch`, no React. This is what makes "test
 * against text transcripts before building UI" possible: every one of these
 * can be exercised with hand-authored data in a vitest file, and the same
 * functions run unchanged once real UI/network code calls them.
 */

/**
 * Below this, "wrap_up" isn't even offered as a valid action — the turn
 * tool's own schema excludes it (see `interview-turn-service.ts`'s
 * `buildTurnTool`), so the model structurally cannot end the interview this
 * early no matter how it reads the conversation so far. Added after a real
 * live-usage failure: with only a soft-guidance floor ("treat early turns as
 * still exploring"), the model wrapped up after just 4 turns on a real
 * pilot's interview — nowhere near enough to touch a meaningful slice of the
 * 15-topic backlog. A model can misjudge or misread soft language; it can't
 * select an action that isn't in its tool's enum.
 *
 * Set at 12, not lower originally: live re-testing after the first fix
 * (floor 8) showed the model reaches directly for wrap_up the instant it's
 * legally available — it stopped at exactly turnsUsed 8 both times, having
 * covered barely half the topic backlog. The model consistently treats
 * "allowed to stop" as "should stop" rather than as a floor with real
 * discretion above it, so the floor itself has to carry more of the weight
 * than the softer guidance further down in the prompt does.
 *
 * Raised to 22 after a further live run at 12 wrapped at turnsUsed 14 —
 * past the floor, but having touched only 6 of 15 explicit-weight ids and
 * skipped 6 of 15 topic-backlog areas entirely, on an engaged, elaborate
 * pilot answering every question with real detail. The floor alone was
 * still the dominant lever on how thorough a real interview actually runs,
 * regardless of how much prose the prompt spent on "don't stop early" —
 * paired with the new per-turn `uncoveredExplicitWeightIds` list (see
 * below), which gives the model a concrete, checkable gap rather than a
 * paragraph to remember to re-read.
 */
export const MIN_TURNS_BEFORE_WRAP = 22;
/**
 * Between MIN_TURNS_BEFORE_WRAP and this, wrap_up is offered but the model
 * is told to keep going unless one more turn is clearly worth it; below
 * MIN_TURNS_BEFORE_WRAP it isn't offered at all (see above). Raised from
 * 18 alongside the same live finding that motivated the floor increase —
 * genuinely covering all 15 explicit-weight ids plus real depth on several
 * topic-backlog threads realistically takes turns in the high 20s/low 30s,
 * not high teens. Product numbers, not engineering ones — easy to retune.
 */
export const SOFT_CAP_TURNS = 32;
/**
 * Enforced client-side, never model-side — the loop simply stops calling
 * the turn route at this point regardless of what the last response asked
 * for, per the hard requirement that a rambling pilot can't make the
 * interview run away no matter what the model itself judges. Raised from 28
 * alongside MIN_TURNS_BEFORE_WRAP/SOFT_CAP_TURNS so the ceiling still sits
 * meaningfully above the new soft cap rather than nearly coinciding with it.
 */
export const HARD_CEILING_TURNS = 42;

/**
 * Every real, closed-catalog explicit-weight id — the single source of truth
 * shared between the system prompt (`interview-prompt.ts`, which needs the
 * full list to describe the catalog) and the per-turn coverage check below
 * (which needs it to know what's still untouched). Kept here rather than in
 * `interview-prompt.ts` so `interview-prompt.ts` can import it without a
 * circular dependency (it already imports `MIN_TURNS_BEFORE_WRAP` from this
 * file). "departures" is deliberately excluded — it's target-only, never a
 * directional slider (see `ExplicitWeightKey`'s own doc comment).
 */
export const EXPLICIT_WEIGHT_IDS = [
  "daysOff", "tripLength", "international", "reportTime", "creditHours",
  "deadheadTolerance", "hotelFood", "hotelGym", "hotelGrocery", "hotelQuiet",
  "hotelQuality", "circadianHealth", "landings", "riskTolerance", "adminEffortAppetite",
] as const;

/**
 * Which explicit-weight ids have zero engagement so far this cycle — fed
 * back into the next turn's own request so the model isn't relying on its
 * own memory of a long system prompt's catalog list to notice a gap. Added
 * after live testing showed the model will happily wrap up a rich-feeling
 * conversation at turnsUsed 14 having never once touched 9 of the 15
 * explicit-weight ids (trip length, the plain pay-vs-lifestyle slider, three
 * of four hotel amenities, the generic circadian-health slider, and both
 * Strategies-board inputs) — soft "check the backlog" prose alone wasn't
 * enough to stop an otherwise-engaged conversation from feeling "done."
 * Making the gap a literal, computed list the model is handed every turn is
 * a much harder thing to rationalize past than a paragraph of guidance it
 * has to remember to re-check itself.
 */
export function uncoveredExplicitWeightIds(facts: PreferenceFact[]): string[] {
  const touched = touchedDimensionIds(facts);
  return EXPLICIT_WEIGHT_IDS.filter((id) => !touched.has(id));
}

export function buildTurnRequest(params: {
  transcript: InterviewTurnRecord[];
  facts: PreferenceFact[];
  grounding: BidPackGroundingStats;
  base: string;
  aircraft: string;
  isCommuter: boolean | null;
  turnsUsed: number;
  priorFactsChanged?: PreferenceFact[];
  lifeEvent?: string;
  contradictionFlag?: { newStatement: string; priorStatement: string };
}): TurnRequestBody {
  return {
    ...params,
    softCapTurns: SOFT_CAP_TURNS,
    hardCeilingTurns: HARD_CEILING_TURNS,
    uncoveredExplicitWeightIds: uncoveredExplicitWeightIds(params.facts),
  };
}

/** Applies the LLM's profile deltas to the running fact list — additive by default, but a later answer can revise or retire an earlier inference as the picture sharpens, not just append forever. */
export function applyProfileUpdates(facts: PreferenceFact[], updates: PreferenceFactUpdate[]): PreferenceFact[] {
  let next = facts;
  for (const update of updates) {
    if (update.op === "add") {
      next = [...next, update.fact];
    } else if (update.op === "revise") {
      const idx = next.findIndex((f) => f.id === update.fact.id);
      next = idx === -1 ? [...next, update.fact] : next.map((f, i) => (i === idx ? update.fact : f));
    } else {
      next = next.filter((f) => f.id !== update.factId);
    }
  }
  return next;
}

/**
 * How much of a bipolar/magnitude slider's -100..100 (or 0..100) range one
 * measurable fact should claim — `fact.importance` (0-1, how strongly the
 * pilot seems to feel) is the natural magnitude driver, the same role a
 * slider's own drag distance plays in the legacy interview. Later facts
 * touching the same key simply overwrite earlier ones (facts are applied in
 * `turnIndex` order), same as a pilot dragging a slider again supersedes
 * its previous position.
 */
function explicitWeightValue(key: ExplicitWeightKey, direction: 1 | -1, importance: number): number {
  const floor = MAGNITUDE_ONLY_KEYS.has(key) ? 0 : -100;
  // Rounded so a 0.55 importance is a clean 55, not 55.00000000000001 — this
  // number is shown to pilots directly on the sliders.
  const magnitude = Math.round(Math.min(1, Math.max(0, importance)) * 100);
  return Math.min(100, Math.max(floor, direction * magnitude));
}

function implicitWeightValue(direction: 1 | -1, importance: number): number {
  const magnitude = Math.min(1, Math.max(0, importance)) * 1.5;
  return Math.min(1.5, Math.max(-1.5, direction * magnitude));
}

/**
 * Deterministically derives the "obvious" measurable fact directly implied
 * by a plain slider/target-slider answer, for any adaptive-turn question
 * with that shape. Returns null for a choice/free-text/wrap-up answer (no
 * numeric value to derive from — direction there is unavoidably the model's
 * own interpretive job) or a slider left at 0 / a target left unset.
 *
 * Exists because leaving even this literal a read to the LLM turned out to
 * be a real, repeat failure mode under live testing (Phase 6 transcript
 * validation): with the exact signed answer value in hand, the model still
 * twice produced a fact whose direction contradicted it (once amplifying a
 * barely-there +10 lean into a confidently wrong -70 in the opposite
 * direction). There's no reason to trust an LLM's reconstruction of a
 * number the client already has exactly. The caller (`interview-turn-
 * service.ts`) appends this fact after the model's own extraction for the
 * same turn, so it wins any conflict for this key via `finalizeAdaptiveProfile`'s
 * "last fact per key, ordered by turnIndex" rule — while still leaving a
 * genuinely later turn's revision (a later turnIndex) free to override it,
 * exactly as intended when new context actually changes the picture.
 */
export function deterministicFactFromAnswer(
  question: InterviewQuestion,
  answer: InterviewAnswer,
  turnIndex: number
): PreferenceFact | null {
  if (question.kind === "slider" && answer.kind === "slider") {
    if (answer.value === 0) return null;
    const towardHigh = answer.value > 0;
    return {
      id: crypto.randomUUID(),
      statement: `${towardHigh ? question.highLabel : question.lowLabel} — answered ${answer.value} on "${question.prompt}"`,
      kind: "measurable",
      measurable: { type: "explicit-weight", key: question.boundTo, direction: towardHigh ? 1 : -1 },
      confidence: 1,
      importance: Math.min(1, Math.abs(answer.value) / 100),
      source: { kind: "adaptive-question", questionId: question.id },
      turnIndex,
    };
  }
  if (question.kind === "target-slider" && answer.kind === "target-slider") {
    if (answer.value === undefined) return null;
    const roleLabel =
      question.rangeRole === "min" ? "floor" : question.rangeRole === "max" ? "ceiling" : "exact target";
    return {
      id: crypto.randomUUID(),
      statement: `Pinned a ${roleLabel} of ${answer.value} on "${question.prompt}"`,
      kind: "measurable",
      measurable: { type: "explicit-target", key: question.boundTo, value: answer.value, rangeRole: question.rangeRole },
      confidence: 1,
      importance: 0.7,
      source: { kind: "adaptive-question", questionId: question.id },
      turnIndex,
    };
  }
  return null;
}

export interface ContradictionFlag {
  newStatement: string;
  priorStatement: string;
}

/**
 * Same-binding-identity, opposite-conclusion check between a just-produced
 * fact and the pilot's prior bid-cycle facts. Deliberately narrow: only
 * measurable bindings get checked here, since they have a clean enough shape
 * (a key/id plus a direction, value, or sentiment) to compare mechanically.
 * A qualitative fact's prose can't be honestly diffed this way — those are
 * left to the model's own judgment once the prior cycle's qualitative facts
 * are sitting in its own context, the same way it already notices things
 * from conversation, not faked with a hand-built NLP layer here.
 */
export function detectContradiction(newFact: PreferenceFact, priorFacts: PreferenceFact[]): ContradictionFlag | null {
  if (newFact.kind !== "measurable" || !newFact.measurable) return null;
  const nb = newFact.measurable;

  for (const prior of priorFacts) {
    if (prior.kind !== "measurable" || !prior.measurable) continue;
    const pb = prior.measurable;
    if (!sameBindingIdentity(nb, pb)) continue;
    return bindingsAgree(nb, pb) ? null : { newStatement: newFact.statement, priorStatement: prior.statement };
  }
  return null;
}

/** Same real-world slot — same key/id and, for a range target, the same role (a floor and a ceiling on the same key are different slots, not a contradiction with each other). */
function sameBindingIdentity(a: MeasurableBinding, b: MeasurableBinding): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "explicit-weight" && b.type === "explicit-weight") return a.key === b.key;
  if (a.type === "explicit-target" && b.type === "explicit-target") return a.key === b.key && a.rangeRole === b.rangeRole;
  if (a.type === "implicit-weight" && b.type === "implicit-weight") return a.variableId === b.variableId;
  if (a.type === "city-sentiment" && b.type === "city-sentiment") return a.code === b.code;
  return false;
}

/** Whether two bindings at the same identity actually reach the same conclusion — a >25% drift on a pinned number counts as real disagreement, not noise from natural month-to-month rounding. */
function bindingsAgree(a: MeasurableBinding, b: MeasurableBinding): boolean {
  if (a.type === "explicit-weight" && b.type === "explicit-weight") return a.direction === b.direction;
  if (a.type === "explicit-target" && b.type === "explicit-target") {
    return Math.abs(a.value - b.value) / Math.max(1, Math.abs(b.value)) <= 0.25;
  }
  if (a.type === "implicit-weight" && b.type === "implicit-weight") return a.direction === b.direction;
  if (a.type === "city-sentiment" && b.type === "city-sentiment") return a.sentiment === b.sentiment;
  return false;
}

/** A binding's real-world identity as a string key, for grouping facts across cycles without an O(n²) scan. */
function bindingIdentityKey(b: MeasurableBinding): string {
  if (b.type === "explicit-weight") return `explicit-weight:${b.key}`;
  if (b.type === "explicit-target") return `explicit-target:${b.key}:${b.rangeRole ?? "ideal"}`;
  if (b.type === "implicit-weight") return `implicit-weight:${b.variableId}`;
  return `city-sentiment:${b.code}`;
}

/**
 * Folds each new fact's cycle history against the prior profile's own facts
 * — a brand-new binding starts a fresh history; one that matches a prior
 * cycle's conclusion gets `reaffirmedCount` incremented (feeds a real
 * confidence floor bump downstream, same `confidence` field `scoring.ts`
 * already reads — no new scoring mechanism); one that disagrees resets the
 * count to 0 and sets `volatile: true`, the interview prompt's cue to keep
 * re-checking this one rather than assuming it's settled.
 */
function foldCycleHistory(facts: PreferenceFact[], priorFacts: PreferenceFact[], newCycleId: string): PreferenceFact[] {
  const priorByIdentity = new Map<string, PreferenceFact>();
  for (const pf of priorFacts) {
    if (pf.kind === "measurable" && pf.measurable) priorByIdentity.set(bindingIdentityKey(pf.measurable), pf);
  }

  return facts.map((f) => {
    if (f.kind !== "measurable" || !f.measurable) return f;
    const prior = priorByIdentity.get(bindingIdentityKey(f.measurable));
    if (!prior || !prior.measurable) {
      return { ...f, cycleHistory: { cycleCount: 1, lastCycleId: newCycleId, reaffirmedCount: 0 } };
    }
    const agrees = bindingsAgree(f.measurable, prior.measurable);
    const priorHistory = prior.cycleHistory ?? { cycleCount: 1, lastCycleId: newCycleId, reaffirmedCount: 0 };
    return {
      ...f,
      cycleHistory: {
        cycleCount: priorHistory.cycleCount + 1,
        lastCycleId: newCycleId,
        reaffirmedCount: agrees ? priorHistory.reaffirmedCount + 1 : 0,
      },
      volatile: agrees ? f.volatile : true,
    };
  });
}

export interface ProfileRichness {
  level: "thin" | "moderate" | "thorough";
  /** Backlog topic labels with no plausible touching fact — only ever populated for topics with a real measurable dimension to check (see TOPIC_COVERAGE_HINTS's own doc comment). */
  uncoveredTopics: string[];
}

function touchedDimensionIds(facts: PreferenceFact[]): Set<string> {
  const ids = new Set<string>();
  for (const f of facts) {
    if (f.kind !== "measurable" || !f.measurable) continue;
    const b = f.measurable;
    if (b.type === "explicit-weight" || b.type === "explicit-target") ids.add(b.key);
    else if (b.type === "implicit-weight") ids.add(b.variableId);
    else ids.add("cityPreference");
  }
  return ids;
}

/**
 * Topic id -> the real dimension/implicit ids that count as "this topic got
 * real ground covered." Deliberately omits every purely-qualitative backlog
 * topic (reserve tolerance, day-of-week needs, commute logistics, seniority,
 * financial context, the "why" behind a city pick) — there's no honest way
 * to detect whether one of those got covered from bindings alone, so rather
 * than guess, richness leans entirely on the topics that actually move the
 * Satisfaction Index, which is also the thing this assessment exists to
 * inform in the first place. "strategy-fit" is omitted for the same reason
 * from the opposite direction: it's a real, cleanly-bindable explicit-weight
 * topic (riskTolerance/adminEffortAppetite), just one that — by design —
 * never moves the Satisfaction Index at all, so crediting it here would
 * inflate a score-confidence metric with something that doesn't affect the
 * score.
 */
const TOPIC_COVERAGE_HINTS: Record<string, string[]> = {
  "home-time": ["daysOff"],
  departures: ["departures", "tripLength"],
  "pay-vs-lifestyle": ["creditHours"],
  "deadhead-commuter": ["deadheadTolerance"],
  "city-preferences": ["cityPreference"],
  "international-intensity": ["international"],
  "report-time-circadian": ["reportTime", "circadianHealth", "backOfClockDeparturesPerTrip", "distinctReportHoursPerTrip"],
  "landings-currency": ["landings"],
  "predictability-variety": ["tripShapeVariancePerLine"],
  "rest-recovery": ["shortRestOvernightsPerTrip", "avgSleepOpportunityHours"],
  "real-schedule-effort-metrics": ["creditPerTafbHour", "dutyToBlockRatio"],
};

/**
 * How thin or rich the resulting profile actually is — not just gathering
 * data, but knowing how much is still unknown. Feeds the Satisfaction
 * Index's confidence display and an honest, optional continue-or-finish
 * nudge on the interview's own wrap-up screen (never a forced continuation).
 */
export function assessProfileRichness(profile: { discoveredFacts: PreferenceFact[] }): ProfileRichness {
  const touched = touchedDimensionIds(profile.discoveredFacts);
  const measurableFacts = profile.discoveredFacts.filter((f) => f.kind === "measurable");
  const avgConfidence =
    measurableFacts.length > 0 ? measurableFacts.reduce((s, f) => s + f.confidence, 0) / measurableFacts.length : 0;

  const uncoveredTopics = INTERVIEW_TOPIC_BACKLOG.filter((t) => {
    const hints = TOPIC_COVERAGE_HINTS[t.id];
    return hints && !hints.some((id) => touched.has(id));
  }).map((t) => t.label);

  const level: ProfileRichness["level"] =
    touched.size >= 9 && avgConfidence >= 0.7 ? "thorough" : touched.size >= 5 ? "moderate" : "thin";

  return { level, uncoveredTopics };
}

/** Normalizes today's bare-number shape and the new `RangeTarget` shape into one read — a bare number has always meant "ideal only." */
function asRangeTarget(value: number | RangeTarget | undefined): RangeTarget {
  if (value === undefined) return {};
  return typeof value === "number" ? { ideal: value } : value;
}

/**
 * The adaptive interview's analog of `buildProfile` (`preference-logic.ts`):
 * folds every measurable fact's binding into the same `weights`/
 * `explicitTargets`/`cityPreferences`/`implicitWeights` shape scoring
 * already understands, and carries every fact (measurable and qualitative)
 * into `discoveredFacts` for the results-screen summary. `isCommuter`/
 * `hasCrashPad`/`cityPreferencesSeed` are threaded through separately since
 * they're collected as dedicated interview steps (commuter status gates
 * several questions' relevance), not discovered facts in their own right.
 */
export function finalizeAdaptiveProfile(params: {
  facts: PreferenceFact[];
  transcript: InterviewTurnRecord[];
  isCommuter: boolean | null;
  hasCrashPad: boolean | null;
  cityPreferencesSeed?: Record<string, CitySentiment>;
  /** The pilot's completed profile from before this cycle, if any — used only to fold `cycleHistory`/`volatile` onto this cycle's own facts (see `foldCycleHistory`). Absent for a first-time interview. */
  priorProfile?: PreferenceProfile | null;
}): PreferenceProfile {
  const { facts, transcript, isCommuter, hasCrashPad, cityPreferencesSeed = {}, priorProfile } = params;

  const weights = emptyWeights();
  const explicitTargets: Partial<Record<ExplicitTargetKey, number | RangeTarget>> = {};
  const cityPreferences: Record<string, CitySentiment> = { ...cityPreferencesSeed };
  const implicitWeights: Record<string, number> = {};
  const implicitConfidence: Record<string, number> = {};

  const cycleId = new Date().toISOString();
  const sortedFacts = [...facts].sort((a, b) => a.turnIndex - b.turnIndex);
  const historyFolded = priorProfile ? foldCycleHistory(sortedFacts, priorProfile.discoveredFacts, cycleId) : sortedFacts;
  // A preference reaffirmed across multiple cycles is real, settled evidence
  // — not just a guess that happened to repeat — so it gets a real
  // confidence floor bump here, feeding the exact same `confidence` field
  // `scoring.ts` already reads downstream. Never lowers an already-higher
  // confidence.
  const orderedFacts = historyFolded.map((f) =>
    (f.cycleHistory?.reaffirmedCount ?? 0) >= 2 ? { ...f, confidence: Math.max(f.confidence, 0.9) } : f
  );

  for (const fact of orderedFacts) {
    if (fact.kind !== "measurable" || !fact.measurable) continue;
    const binding = fact.measurable;

    if (binding.type === "explicit-weight") {
      weights[binding.key] = explicitWeightValue(binding.key, binding.direction, fact.importance);
      implicitConfidence[binding.key] = Math.max(implicitConfidence[binding.key] ?? 0, fact.confidence);
    } else if (binding.type === "explicit-target") {
      // No rangeRole at all (creditHours, or any bare single-number answer)
      // still just overwrites — identical to today's behavior. Any real
      // role ("min"/"ideal"/"max") instead merges into whatever range is
      // already building for this key, so a floor answered on one turn
      // survives an ideal answered on a later one.
      if (binding.rangeRole === undefined) {
        explicitTargets[binding.key] = binding.value;
      } else {
        const existing = asRangeTarget(explicitTargets[binding.key]);
        explicitTargets[binding.key] = { ...existing, [binding.rangeRole]: binding.value };
      }
    } else if (binding.type === "implicit-weight") {
      implicitWeights[binding.variableId] = implicitWeightValue(binding.direction, fact.importance);
      implicitConfidence[binding.variableId] = Math.max(implicitConfidence[binding.variableId] ?? 0, fact.confidence);
    } else {
      cityPreferences[binding.code] = binding.sentiment;
    }
  }

  return {
    weights,
    deepRoundCompleted: true,
    tradeoffAnswers: [],
    explicitTargets,
    isCommuter,
    cityPreferences,
    hasCrashPad,
    completedAt: cycleId,
    implicitWeights,
    implicitConfidence,
    discoveredFacts: orderedFacts,
    interviewTranscript: transcript,
  };
}
