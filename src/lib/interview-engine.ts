import { emptyWeights } from "@/lib/preference-logic";
import { MAGNITUDE_ONLY_KEYS } from "@/lib/rank-learning";
import type {
  BidPackGroundingStats,
  ExplicitWeightKey,
  InterviewAnswer,
  InterviewQuestion,
  InterviewTurnRecord,
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
 * Below this, the model can end anytime; between this and HARD_CEILING_TURNS
 * it's told to wrap up unless one more turn is clearly worth it. Raised from
 * 10/16 alongside the interview topic-backlog expansion — there's roughly
 * 3x the topic ground to cover now that the interview is one continuous
 * loop with no separate free seed round (see `AdaptiveInterview.tsx`'s own
 * doc comment). Product numbers, not engineering ones — easy to retune.
 */
export const SOFT_CAP_TURNS = 18;
/**
 * Enforced client-side, never model-side — the loop simply stops calling
 * the turn route at this point regardless of what the last response asked
 * for, per the hard requirement that a rambling pilot can't make the
 * interview run away no matter what the model itself judges.
 */
export const HARD_CEILING_TURNS = 28;

export function buildTurnRequest(params: {
  transcript: InterviewTurnRecord[];
  facts: PreferenceFact[];
  grounding: BidPackGroundingStats;
  base: string;
  aircraft: string;
  isCommuter: boolean | null;
  turnsUsed: number;
}): TurnRequestBody {
  return {
    ...params,
    softCapTurns: SOFT_CAP_TURNS,
    hardCeilingTurns: HARD_CEILING_TURNS,
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
  const magnitude = Math.min(1, Math.max(0, importance)) * 100;
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
}): PreferenceProfile {
  const { facts, transcript, isCommuter, hasCrashPad, cityPreferencesSeed = {} } = params;

  const weights = emptyWeights();
  const explicitTargets: Partial<Record<ExplicitTargetKey, number | RangeTarget>> = {};
  const cityPreferences: Record<string, CitySentiment> = { ...cityPreferencesSeed };
  const implicitWeights: Record<string, number> = {};
  const implicitConfidence: Record<string, number> = {};

  const orderedFacts = [...facts].sort((a, b) => a.turnIndex - b.turnIndex);

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
    completedAt: new Date().toISOString(),
    implicitWeights,
    implicitConfidence,
    discoveredFacts: orderedFacts,
    interviewTranscript: transcript,
  };
}
