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
 * Below this many questions, "wrap_up" isn't offered at all — the turn tool's
 * own schema drops it (see `buildTurnTool`), because a model told it *may*
 * stop treats that as *should* stop: live, a soft floor let it wrap after 4
 * questions, then exactly at 8, then at 14 with half the catalog untouched.
 *
 * The floor is no longer what keeps the interview thorough, though — the
 * coverage gate (`uncoveredExplicitWeightIds`) and the essential
 * conversations (`openEssentials`) are. A fixed floor of 22 contradicted the
 * story screen's own promise ("the more you give here, the fewer questions
 * later"): live-tested, a pilot whose 700-word story covered 13 of 16
 * dimensions still got 22 questions, the model's own reasoning saying
 * "turnsUsed is only 12, below the 22 floor" while it re-asked a duty-period
 * ceiling he'd already given. So the floor now drops one question for every
 * dimension the story covered, never below `MIN_TURNS_FLOOR`.
 */
export const MIN_TURNS_BEFORE_WRAP = 16;
/** The lowest the story-adjusted floor goes — a thorough story still leaves real follow-up worth asking. */
export const MIN_TURNS_FLOOR = 10;

/** The story-adjusted floor — see `MIN_TURNS_BEFORE_WRAP`. */
export function minTurnsBeforeWrap(facts: PreferenceFact[]): number {
  const fromStory = new Set<string>();
  for (const f of facts) {
    if (f.source.kind !== "seed-question" || f.source.questionKey !== "bidding-story" || !f.measurable) continue;
    if (f.measurable.type === "explicit-weight" || f.measurable.type === "explicit-target") fromStory.add(f.measurable.key);
  }
  return Math.max(MIN_TURNS_FLOOR, MIN_TURNS_BEFORE_WRAP - fromStory.size);
}

/** Once the floor and every gate are met, the model may keep going while a question would still change the ranking — up to here, where it's told to wrap. */
export const SOFT_CAP_TURNS = 28;
/**
 * Enforced client-side, never model-side — the loop simply stops calling the
 * turn route at this point regardless of what the last response asked for,
 * so a rambling pilot can't make the interview run away.
 */
export const HARD_CEILING_TURNS = 36;

/**
 * The conversations an interview has to have before it can wrap, beyond
 * catalog coverage — each one a real gap a pilot would notice: never being
 * asked about the dates that matter this month, a city they flagged with no
 * why, a commuter never asked about the commute, no chance to say "you
 * missed something." Satisfied by a question tagged with that topic (the
 * model tags every question — see `InterviewQuestion.topic`), or by facts
 * that already answer it.
 */
export function openEssentials(params: { transcript: InterviewTurnRecord[]; facts: PreferenceFact[]; isCommuter: boolean | null }): string[] {
  const { transcript, facts, isCommuter } = params;
  const asked = new Set(transcript.map((t) => t.question.topic).filter((t): t is string => !!t));
  const open: string[] = [];

  if (!asked.has("day-of-week-calendar")) open.push("day-of-week-calendar");

  const hasTarget = (key: string) => facts.some((f) => f.measurable?.type === "explicit-target" && f.measurable.key === key);
  if (!hasTarget("daysOff") && !asked.has("home-time")) open.push("home-time");
  // How many times they report — one of the first numbers a pilot reads on a line.
  if (!hasTarget("dutyPeriods") && !asked.has("duty-periods")) open.push("duty-periods");

  const cityCodes = facts.flatMap((f) => (f.measurable?.type === "city-sentiment" ? [f.measurable.code] : []));
  const reasoned = new Set(facts.flatMap((f) => (f.cityReason ? [f.cityReason.code] : [])));
  if (cityCodes.some((c) => !reasoned.has(c)) && !asked.has("city-preferences")) open.push("city-preferences");

  if (isCommuter && !asked.has("deadhead-commuter") && !asked.has("commute-logistics-detail")) open.push("commute-logistics-detail");

  // Always last: once everything else is done, one open "anything I missed?" before wrapping.
  if (!asked.has("closing")) open.push("closing");
  return open;
}

/**
 * Every real, closed-catalog explicit-weight id — the single source of truth
 * shared between the system prompt (`interview-prompt.ts`, which needs the
 * full list to describe the catalog) and the per-turn coverage check below
 * (which needs it to know what's still untouched). Kept here rather than in
 * `interview-prompt.ts` so `interview-prompt.ts` can import it without a
 * circular dependency (it already imports `MIN_TURNS_BEFORE_WRAP` from this
 * file). "dutyPeriods" is deliberately excluded — it's target-only, never a
 * directional slider (see `ExplicitWeightKey`'s own doc comment).
 */
export const EXPLICIT_WEIGHT_IDS = [
  "daysOff", "tripLength", "international", "reportTime", "creditHours",
  "deadheadTolerance", "hotelFood", "hotelGym", "hotelGrocery", "hotelQuiet",
  "hotelQuality", "circadianHealth", "landings", "hotelStandby", "riskTolerance", "adminEffortAppetite",
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
export function uncoveredExplicitWeightIds(facts: PreferenceFact[], hasStandby = true): string[] {
  const touched = touchedDimensionIds(facts);
  return applicableExplicitWeightIds(hasStandby).filter((id) => !touched.has(id));
}

/** Whether this pilot's own bid pack has any hotel standby at all — a pack with none can't separate one line from another on it, so the interview neither asks about it nor waits on it. */
export function packHasHotelStandby(grounding: BidPackGroundingStats): boolean {
  return (grounding.hotelStandby?.linesWithStandby ?? 0) > 0;
}

/** The explicit-weight ids this interview has to cover — everything, minus hotel standby when the pack has none. */
export function applicableExplicitWeightIds(hasStandby: boolean): readonly string[] {
  return hasStandby ? EXPLICIT_WEIGHT_IDS : EXPLICIT_WEIGHT_IDS.filter((id) => id !== "hotelStandby");
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
  bidStory?: string;
  seniorityKnown?: boolean;
  commuteFrom?: string;
}): TurnRequestBody {
  const uncovered = uncoveredExplicitWeightIds(params.facts, packHasHotelStandby(params.grounding));
  const floor = minTurnsBeforeWrap(params.facts);
  const essentials = openEssentials(params);
  return {
    ...params,
    softCapTurns: SOFT_CAP_TURNS,
    hardCeilingTurns: HARD_CEILING_TURNS,
    uncoveredExplicitWeightIds: uncovered,
    minTurnsBeforeWrap: floor,
    openEssentials: essentials,
    closingAllowed:
      uncovered.length === 0 && essentials.every((e) => e === "closing") && essentials.includes("closing") && params.turnsUsed >= floor - 1,
  };
}

/**
 * Whether two facts are about the same real thing, so the newer replaces the
 * older instead of sitting beside it: the same measurable slot (key/variable/
 * city, and for a range target the same role), the same weekly commitment,
 * the same dates, or a qualitative fact restated word for word. Live, every
 * one of these produced duplicates a pilot would see — a weekly commitment
 * softened on one turn and restated on another kept both (and the old
 * dealbreaker); "no standby, period" said twice became two dealbreaker
 * banners on every standby line; a date stated firmly twice showed three
 * times. Word-for-word matching is limited to qualitative facts: one
 * sentence can legitimately back several measurable facts ("none of the
 * food, gym or grocery stuff matters" is three bindings).
 */
function sameRealThing(a: PreferenceFact, b: PreferenceFact): boolean {
  if (a.measurable && b.measurable) return bindingIdentityKey(a.measurable) === bindingIdentityKey(b.measurable);
  if (a.measurable || b.measurable) return false;
  if (a.recurringWeekday && a.recurringWeekday === b.recurringWeekday) return true;
  if (a.specificDates && b.specificDates && sameDates(a.specificDates, b.specificDates)) return true;
  return normalizedStatement(a.statement) === normalizedStatement(b.statement);
}

function sameDates(a: string[], b: string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((d, i) => d === y[i]);
}

function normalizedStatement(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Applies the LLM's profile deltas to the running fact list — additive by default, but a later answer can revise or retire an earlier inference as the picture sharpens, and a new fact about something already on file replaces it (see `sameRealThing`). */
export function applyProfileUpdates(facts: PreferenceFact[], updates: PreferenceFactUpdate[]): PreferenceFact[] {
  let next = facts;
  for (const update of updates) {
    if (update.op === "retire") {
      next = next.filter((f) => f.id !== update.factId);
      continue;
    }
    const incoming = update.fact;
    // A revise of a real id replaces that fact in place; anything else
    // (an add, or a revise of an id the model invented) is appended — and
    // either way, whatever else was about the same real thing goes.
    const idx = update.op === "revise" ? next.findIndex((f) => f.id === incoming.id) : -1;
    const others = next.filter((f, i) => i === idx || !sameRealThing(f, incoming));
    const at = idx === -1 ? -1 : others.findIndex((f) => f.id === incoming.id);
    next = at === -1 ? [...others, incoming] : others.map((f, i) => (i === at ? incoming : f));
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
      statement: `Pinned ${roleLabel === "exact target" ? "an" : "a"} ${roleLabel} of ${answer.value} on "${question.prompt}"`,
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
  "home-time": ["daysOff", "longestDaysOffBlockPerLine", "weekendDaysOffPerLine"],
  "duty-periods": ["dutyPeriods", "tripLength"],
  "pay-vs-lifestyle": ["creditHours"],
  "deadhead-commuter": ["deadheadTolerance"],
  "city-preferences": ["cityPreference"],
  "international-intensity": ["international"],
  "report-time-circadian": ["reportTime", "circadianHealth", "backOfClockDeparturesPerTrip", "distinctReportHoursPerTrip"],
  "landings-currency": ["landings"],
  "hotel-standby": ["hotelStandby", "longestStandbyStretchPerLine", "standbyStintsPerLine"],
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
  /** Where a commuter commutes from (airport code), when they said. */
  commuteFrom?: string | null;
  /** Entered at the start of the interview; a returning pilot who left it blank keeps the number from last cycle. */
  seniorityNumber?: number | null;
  cityPreferencesSeed?: Record<string, CitySentiment>;
  /** The pilot's completed profile from before this cycle, if any — used only to fold `cycleHistory`/`volatile` onto this cycle's own facts (see `foldCycleHistory`). Absent for a first-time interview. */
  priorProfile?: PreferenceProfile | null;
}): PreferenceProfile {
  const { facts, transcript, isCommuter, hasCrashPad, cityPreferencesSeed = {}, priorProfile } = params;
  const seniorityNumber = params.seniorityNumber ?? priorProfile?.seniorityNumber ?? null;

  const weights = emptyWeights();
  const explicitTargets: Partial<Record<ExplicitTargetKey, number | RangeTarget>> = {};
  const cityPreferences: Record<string, CitySentiment> = { ...cityPreferencesSeed };
  const implicitWeights: Record<string, number> = {};
  const implicitConfidence: Record<string, number> = {};
  const targetImportance: Partial<Record<ExplicitTargetKey, number>> = {};

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
      // How much the target matters, and how sure we are of it — the
      // strongest statement about this target wins, so a floor said firmly
      // isn't watered down by a later passing mention of the ideal.
      targetImportance[binding.key] = Math.max(targetImportance[binding.key] ?? 0, fact.importance);
      implicitConfidence[binding.key] = Math.max(implicitConfidence[binding.key] ?? 0, fact.confidence);
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
    targetImportance,
    isCommuter,
    commuteFrom: isCommuter ? params.commuteFrom ?? priorProfile?.commuteFrom ?? null : null,
    cityPreferences,
    hasCrashPad,
    seniorityNumber,
    completedAt: cycleId,
    implicitWeights,
    implicitConfidence,
    discoveredFacts: orderedFacts,
    interviewTranscript: transcript,
  };
}
