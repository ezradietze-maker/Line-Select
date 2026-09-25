"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Heading } from "@/components/ui/Heading";
import { ScreenTransition } from "@/components/ui/ScreenTransition";
import { SelectableCard } from "@/components/ui/SelectableCard";
import { Spinner } from "@/components/ui/Spinner";
import { CityPreferenceStep } from "@/components/interview/CityPreferenceStep";
import { CommuterStep } from "@/components/interview/CommuterStep";
import { FreeTextAnswerBox } from "@/components/interview/FreeTextAnswerBox";
import { ReturningPilotCheckStep } from "@/components/interview/ReturningPilotCheckStep";
import { SliderStep } from "@/components/interview/SliderStep";
import { TargetSliderStep } from "@/components/interview/TargetSliderStep";
import {
  HARD_CEILING_TURNS,
  MIN_TURNS_BEFORE_WRAP,
  applyProfileUpdates,
  assessProfileRichness,
  buildTurnRequest,
  detectContradiction,
  finalizeAdaptiveProfile,
  packHasHotelStandby,
  uncoveredExplicitWeightIds,
  type ContradictionFlag,
} from "@/lib/interview-engine";
import { clearDraft, loadDraft, saveDraft, type InterviewDraft } from "@/lib/interview-draft";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { computeInterviewProgress } from "@/lib/interview-progress";
import { cycleCitySentiment } from "@/lib/preference-logic";
import { getBidPackRanges, rankLayoverCitiesByFrequency } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type {
  InterviewAnswer,
  InterviewQuestion,
  InterviewTurnRecord,
  PreferenceFact,
  PreferenceFactUpdate,
  TurnResponse,
} from "@/types/interview-session";
import type { CitySentiment, PreferenceProfile } from "@/types/preferences";

/**
 * A continuous conversation from the first real question to the last — not
 * a static form with AI follow-ups bolted on afterward. Only two things
 * happen before the turn loop starts, and both are widget-shaped tasks a
 * conversation would handle worse, not substantive preference-gathering:
 * commute status (`CommuterStep`, needed to correctly phrase several later
 * topics) and an initial city love/avoid pass (`CityPreferenceStep`, a
 * multi-select genuinely faster than naming cities one at a time in
 * free text). Both seed real facts into the loop's own starting context —
 * the city picks specifically so the model's very first turns can ask
 * *why* a flagged city is loved or avoided, per the interview topic
 * backlog (`interview-prompt.ts`) — rather than sitting in a side channel
 * the model never sees.
 *
 * Every other topic — the reworked originals (home time, duty periods, pay
 * vs. lifestyle, deadhead/commute, per-city "why") and everything new
 * (landings, international ceiling, report-time/circadian tolerance,
 * reserve tolerance, predictability vs. variety, rest/recovery, financial
 * context, and the topics that stay qualitative-only for lack of reliable
 * calendar data) — is entirely the turn loop's call: what to ask, how deep
 * to go, when to move on. There is no guaranteed-free deterministic round
 * anymore; every question after the two pre-steps is a real `/api/interview-turn`
 * call, which is why the turn budget (`SOFT_CAP_TURNS`/`HARD_CEILING_TURNS`)
 * was raised alongside this restructure — there's roughly 3x the topic
 * ground a thorough interview might actually cover now.
 */

interface AdaptiveInterviewProps {
  bidPack: BidPack;
  onComplete: (profile: PreferenceProfile) => void;
  /** This pilot's completed profile from a prior bid cycle, if any — enables the returning-pilot check step and cross-cycle contradiction/volatility tracking. Absent (or a profile with no discoveredFacts, e.g. one from the legacy static interview) means a first-time-shaped interview, unchanged from before this existed. */
  priorProfile?: PreferenceProfile | null;
  /** Whose device-local saved progress to read/write — null for a guest. */
  userId?: string | null;
}

const TOP_PRIOR_FACTS_SHOWN = 5;
/**
 * Not a bid-pack-derived quantity (see `ExplicitTargetKey`'s own doc comment
 * on why `circadianTolerance` is the odd one out) — a fixed, sensible
 * self-report bound instead of something read out of `getBidPackRanges`.
 */
const CIRCADIAN_TOLERANCE_RANGE: readonly [number, number] = [0, 4];

type Phase = "commuter" | "cities" | "returning-check" | "adaptive-loading" | "adaptive-question" | "finishing";

/** Highest-confidence, most load-bearing prior-cycle facts worth actively re-confirming — dealbreakers first, then by importance*confidence. Everything else from the prior profile carries forward unreviewed (see `ReturningPilotCheckStep`'s own copy). */
function topPriorFacts(discoveredFacts: PreferenceFact[], limit: number): PreferenceFact[] {
  return [...discoveredFacts]
    .sort((a, b) => {
      const aDealbreaker = a.severity === "dealbreaker" ? 1 : 0;
      const bDealbreaker = b.severity === "dealbreaker" ? 1 : 0;
      if (aDealbreaker !== bDealbreaker) return bDealbreaker - aDealbreaker;
      return b.importance * b.confidence - a.importance * a.confidence;
    })
    .slice(0, limit);
}

/** Deterministic, network-free conversion of the city picker's initial picks into real facts — so the turn loop's very first context already includes them, and the model can follow up on *why* rather than the picks sitting in a side channel it never sees. */
function factsFromCityPreferences(cityPreferences: Record<string, CitySentiment>): PreferenceFact[] {
  return Object.entries(cityPreferences).map(([code, sentiment]) => ({
    id: crypto.randomUUID(),
    statement: `${sentiment === "love" ? "Loves" : "Wants to avoid"} layovers in ${code}.`,
    kind: "measurable",
    measurable: { type: "city-sentiment", code, sentiment },
    confidence: 1,
    importance: 0.6,
    source: { kind: "seed-question", questionKey: "cities" },
    turnIndex: 0,
  }));
}

function StepNav({ onNext, nextLabel, disabled }: { onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div className="mt-10 flex items-center justify-end">
      <Button onClick={onNext} disabled={disabled}>
        {nextLabel}
      </Button>
    </div>
  );
}

/** A thin, honest progress bar with a plain-language readout — replaces a row of ~36 dots labeled "question 2 of roughly 35", which overstated the length up front. */
function InterviewProgressBar({ fraction, label }: { fraction: number; label: string }) {
  return (
    <div className="mb-8">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-label="Interview progress"
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, fraction * 100)}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

/** What the pilot needs back to undo an answer: the question they saw and the interview's state from just before they answered it. */
interface AnswerSnapshot {
  question: InterviewQuestion;
  facts: PreferenceFact[];
  transcript: InterviewTurnRecord[];
  turnsUsed: number;
}

/** A prior-cycle city pick is re-asked on the cities step itself (prefilled), so it must not also ride along as a carried-over fact — a pick the pilot just cleared would otherwise silently come back. */
function isCitySentimentFact(f: PreferenceFact): boolean {
  return f.measurable?.type === "city-sentiment";
}

/**
 * "Free-text elaboration... should always be an option, not just a slider"
 * — offered on every adaptive slider/target-slider/choice question, not
 * only when the model itself happens to pick "free-text" as the question
 * kind. Collapsed by default so it doesn't visually compete with the
 * primary answer control; the pilot opts in only if they actually want to
 * explain themselves. Read by the same extraction call that already
 * processes the primary answer — no extra network round trip.
 */
function ElaborationToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(value.length > 0);
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-4 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
      >
        Want to explain why?
      </button>
    );
  }
  return (
    <div className="mt-4">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional — anything about this answer worth knowing"
        rows={2}
        className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
      />
    </div>
  );
}

export function AdaptiveInterview({ bidPack, onComplete, priorProfile, userId = null }: AdaptiveInterviewProps) {
  const grounding = useMemo(() => computeBidPackGroundingStats(bidPack), [bidPack]);
  const hasStandby = packHasHotelStandby(grounding);
  const ranges = useMemo(() => getBidPackRanges(bidPack), [bidPack]);
  // Every layover city in the pack, not just the 12 most frequent — a pilot's
  // favorite (HNL on a real B777 pack) is very often not one of the most
  // visited, and silently not offering it meant they could never flag it here.
  const allCities = useMemo(() => rankLayoverCitiesByFrequency(bidPack).map((c) => c.code), [bidPack]);
  const hasReturningCheck = !!priorProfile && priorProfile.discoveredFacts.length > 0;
  const preStepCount = hasReturningCheck ? 3 : 2;
  const priorFactsForCheck = useMemo(
    () => (hasReturningCheck ? priorProfile!.discoveredFacts.filter((f) => !isCitySentimentFact(f)) : []),
    [hasReturningCheck, priorProfile]
  );
  const priorTopFacts = useMemo(
    () => topPriorFacts(priorFactsForCheck, TOP_PRIOR_FACTS_SHOWN),
    [priorFactsForCheck]
  );

  const [phase, setPhase] = useState<Phase>("commuter");
  // A returning pilot starts from last cycle's answers — still shown, so a
  // change (a move, a new crash pad) is one tap, but never re-asked blank.
  const [isCommuter, setIsCommuter] = useState<boolean | null>(priorProfile?.isCommuter ?? null);
  const [hasCrashPad, setHasCrashPad] = useState<boolean | null>(priorProfile?.hasCrashPad ?? null);
  const [cityPreferences, setCityPreferences] = useState<Record<string, CitySentiment>>(() => ({
    ...(priorProfile?.cityPreferences ?? {}),
  }));
  const [changedFactIds, setChangedFactIds] = useState<Set<string>>(new Set());
  const [lifeEvent, setLifeEvent] = useState("");
  const [pendingContradiction, setPendingContradiction] = useState<ContradictionFlag | null>(null);

  const [facts, setFacts] = useState<PreferenceFact[]>([]);
  const [transcript, setTranscript] = useState<InterviewTurnRecord[]>([]);
  const [turnsUsed, setTurnsUsed] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  const [choiceSelection, setChoiceSelection] = useState<number | null>(null);
  const [choiceElaboration, setChoiceElaboration] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Snapshots for "Back" — a ref for the logic (async callbacks need the
  // latest value) mirrored into a count for rendering.
  const historyRef = useRef<AnswerSnapshot[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [savedDraft] = useState<InterviewDraft | null>(() => loadDraft(userId, bidPack.id));
  const [resumeDismissed, setResumeDismissed] = useState(false);

  function pushHistory(snapshot: AnswerSnapshot) {
    historyRef.current = [...historyRef.current, snapshot];
    setHistoryCount(historyRef.current.length);
  }

  function popHistory(): AnswerSnapshot | null {
    const last = historyRef.current.at(-1) ?? null;
    if (last) {
      historyRef.current = historyRef.current.slice(0, -1);
      setHistoryCount(historyRef.current.length);
    }
    return last;
  }

  function restoreSnapshot(snapshot: AnswerSnapshot, message: string | null) {
    setFacts(snapshot.facts);
    setTranscript(snapshot.transcript);
    setTurnsUsed(snapshot.turnsUsed);
    setCurrentQuestion(snapshot.question);
    setChoiceSelection(null);
    setChoiceElaboration("");
    setPendingContradiction(null);
    setError(message);
    setPhase("adaptive-question");
  }

  /** A failed turn request used to leave an empty card (the answered question was already cleared) with the error nowhere in sight. Now the pilot lands back on the question they just answered, with the reason, and can simply answer again. */
  function failTurn(message: string) {
    const last = popHistory();
    if (last) {
      restoreSnapshot(last, message);
      return;
    }
    setError(message);
    setPhase(hasReturningCheck ? "returning-check" : "cities");
  }

  function goBack() {
    setError(null);
    if (phase === "adaptive-question") {
      const last = popHistory();
      if (last) {
        restoreSnapshot(last, null);
        return;
      }
      // First real question: back to the last pre-step. Nothing answered yet in the loop, so nothing to keep.
      setCurrentQuestion(null);
      setFacts([]);
      setTranscript([]);
      setTurnsUsed(0);
      setPhase(hasReturningCheck ? "returning-check" : "cities");
    } else if (phase === "returning-check") {
      setPhase("cities");
    } else if (phase === "cities") {
      setPhase("commuter");
    }
  }

  function resumeSavedDraft(d: InterviewDraft) {
    setIsCommuter(d.isCommuter);
    setHasCrashPad(d.hasCrashPad);
    setCityPreferences(d.cityPreferences);
    setFacts(d.facts);
    setTranscript(d.transcript);
    setTurnsUsed(d.turnsUsed);
    setCurrentQuestion(d.currentQuestion);
    setChoiceSelection(null);
    setChoiceElaboration("");
    setPhase("adaptive-question");
  }

  function finish(finalFacts: PreferenceFact[], finalTranscript: InterviewTurnRecord[]) {
    clearDraft(userId);
    setPhase("finishing");
    const profile = finalizeAdaptiveProfile({
      facts: finalFacts,
      transcript: finalTranscript,
      isCommuter,
      hasCrashPad,
      cityPreferencesSeed: cityPreferences,
      priorProfile,
    });
    onComplete(profile);
  }

  async function requestNextTurn(
    nextFacts: PreferenceFact[],
    nextTranscript: InterviewTurnRecord[],
    nextTurnsUsed: number,
    extras?: { priorFactsChanged?: PreferenceFact[]; lifeEvent?: string }
  ) {
    setPhase("adaptive-loading");
    setError(null);
    const contradictionForThisTurn = pendingContradiction;
    if (contradictionForThisTurn) setPendingContradiction(null);
    try {
      const body = buildTurnRequest({
        transcript: nextTranscript,
        facts: nextFacts,
        grounding,
        base: bidPack.base,
        aircraft: bidPack.aircraft,
        isCommuter,
        turnsUsed: nextTurnsUsed,
        priorFactsChanged: extras?.priorFactsChanged,
        lifeEvent: extras?.lifeEvent,
        contradictionFlag: contradictionForThisTurn ?? undefined,
      });
      const res = await fetch("/api/interview-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        failTurn(body?.error ?? "Couldn't reach the interview service. Try again.");
        return;
      }
      const turn = (await res.json()) as TurnResponse;
      const mergedFacts = applyProfileUpdates(nextFacts, turn.profileUpdates);
      setFacts(mergedFacts);

      // Cross-cycle contradiction check: only ever runs against a real prior
      // profile, and only on facts this exact turn actually added/revised —
      // not a re-scan of the whole running fact list every turn. A hit is
      // queued for the *next* request rather than acted on immediately,
      // since this turn's own question still needs to be shown/answered first.
      if (priorProfile) {
        const newlyMeasurable: PreferenceFact[] = turn.profileUpdates
          .filter((u): u is Extract<PreferenceFactUpdate, { op: "add" | "revise" }> => u.op === "add" || u.op === "revise")
          .map((u) => u.fact)
          .filter((f) => f.kind === "measurable");
        for (const f of newlyMeasurable) {
          const flag = detectContradiction(f, priorProfile.discoveredFacts);
          if (flag) {
            setPendingContradiction(flag);
            break;
          }
        }
      }

      if (turn.action === "wrap_up" || !turn.question) {
        finish(mergedFacts, nextTranscript);
        return;
      }
      setCurrentQuestion(turn.question);
      setChoiceSelection(null);
      setChoiceElaboration("");
      setPhase("adaptive-question");
    } catch {
      failTurn("Couldn't reach the interview service. Check your connection and try again.");
    }
  }

  function handleAdaptiveAnswer(answer: InterviewAnswer) {
    if (!currentQuestion) return;
    pushHistory({ question: currentQuestion, facts, transcript, turnsUsed });
    const nextTranscript: InterviewTurnRecord[] = [
      ...transcript,
      { turnIndex: turnsUsed, question: currentQuestion, answer, profileFactIdsTouched: [] },
    ];
    const nextTurnsUsed = turnsUsed + 1;
    setTranscript(nextTranscript);
    setTurnsUsed(nextTurnsUsed);
    setCurrentQuestion(null);

    if (nextTurnsUsed >= HARD_CEILING_TURNS) {
      // Hard ceiling enforced client-side, regardless of what the model would have asked next.
      finish(facts, nextTranscript);
      return;
    }
    requestNextTurn(facts, nextTranscript, nextTurnsUsed);
  }

  const preStepsDone = phase === "commuter" ? 0 : phase === "cities" ? 1 : phase === "returning-check" ? 2 : preStepCount;
  const progress = computeInterviewProgress({
    turnsUsed,
    uncoveredCount: uncoveredExplicitWeightIds(facts, hasStandby).length,
    hasStandby,
    preStepsDone,
    preStepTotal: preStepCount,
  });
  const progressLabel =
    phase === "commuter" || phase === "cities" || phase === "returning-check"
      ? "Getting started \u2014 about 8\u201310 minutes in all, and you can stop any time."
      : `${progress.topicsCovered} of ${progress.topicsTotal} topics covered \u00b7 about ${progress.minutesLeft} min left`;

  // Progress worth resuming: only after at least one real answer, and only while a question is on screen.
  useEffect(() => {
    if (phase !== "adaptive-question" || !currentQuestion) return;
    // Nothing answered yet (a fresh start, or backed all the way up) is nothing worth resuming.
    if (turnsUsed === 0) {
      clearDraft(userId);
      return;
    }
    saveDraft(userId, {
      version: 1,
      bidPackId: bidPack.id,
      savedAt: Date.now(),
      isCommuter,
      hasCrashPad,
      cityPreferences,
      facts,
      transcript,
      turnsUsed,
      currentQuestion,
    });
  }, [phase, currentQuestion, userId, bidPack.id, isCommuter, hasCrashPad, cityPreferences, facts, transcript, turnsUsed]);

  // After a resume there's no in-memory history, so Back is only offered from the very first question (to the pre-steps) or once new answers exist to undo — never in a way that would wipe resumed progress.
  const canGoBack =
    (phase === "adaptive-question" && !!currentQuestion && (historyCount > 0 || turnsUsed === 0)) ||
    phase === "returning-check" ||
    phase === "cities";
  const showResumePrompt = !!savedDraft && !resumeDismissed && phase === "commuter";

  const stepKey =
    phase === "commuter"
      ? "commuter"
      : phase === "cities"
        ? "cities"
        : phase === "returning-check"
          ? "returning-check"
          : currentQuestion
            ? `q-${currentQuestion.id}`
            : phase;

  const content = (() => {
    if (phase === "commuter") {
      return (
        <div>
          <CommuterStep value={isCommuter} onChange={setIsCommuter} base={bidPack.base} />
          <StepNav onNext={() => setPhase("cities")} nextLabel="Next" disabled={isCommuter === null} />
          {isCommuter === true && (
            <div className="mt-6 rounded-lg border border-border bg-canvas p-4">
              <div className="text-sm font-medium text-ink">Got a crash pad in domicile?</div>
              <p className="mt-1 text-xs text-ink-muted">
                Worth factoring in — without a place to stage between duty days, an extra separate trip costs
                you more than it would otherwise.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={hasCrashPad === true}
                  onClick={() => setHasCrashPad(true)}
                  className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-all ${
                    hasCrashPad === true
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
                  }`}
                >
                  Yes, I&rsquo;ve got a place
                </button>
                <button
                  type="button"
                  aria-pressed={hasCrashPad === false}
                  onClick={() => setHasCrashPad(false)}
                  className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-all ${
                    hasCrashPad === false
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
                  }`}
                >
                  No crash pad
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (phase === "cities") {
      return (
        <div>
          <CityPreferenceStep
            cities={allCities}
            preferences={cityPreferences}
            onToggleCity={(code) => setCityPreferences((prev) => cycleCitySentiment(prev, code))}
          />
          <StepNav
            onNext={() => {
              const cityFacts = factsFromCityPreferences(cityPreferences);
              setFacts(cityFacts);
              if (hasReturningCheck) {
                setPhase("returning-check");
              } else {
                requestNextTurn(cityFacts, transcript, 0);
              }
            }}
            nextLabel="Continue"
          />
        </div>
      );
    }

    if (phase === "returning-check") {
      const otherFactCount = priorFactsForCheck.length - priorTopFacts.length;
      return (
        <div>
          <ReturningPilotCheckStep
            topFacts={priorTopFacts}
            changedFactIds={changedFactIds}
            onToggleFact={(factId) =>
              setChangedFactIds((prev) => {
                const next = new Set(prev);
                if (next.has(factId)) next.delete(factId);
                else next.add(factId);
                return next;
              })
            }
            otherFactCount={otherFactCount}
            lifeEvent={lifeEvent}
            onLifeEventChange={setLifeEvent}
          />
          <StepNav
            onNext={() => {
              const shownIds = new Set(priorTopFacts.map((f) => f.id));
              const carriedOver = priorFactsForCheck.filter((f) => !shownIds.has(f.id));
              const confirmedShown = priorTopFacts.filter((f) => !changedFactIds.has(f.id));
              const changedShown = priorTopFacts.filter((f) => changedFactIds.has(f.id));
              const confirmedFacts = [...carriedOver, ...confirmedShown].map((f) => ({ ...f, turnIndex: 0 }));
              const initialFacts = [...facts, ...confirmedFacts];
              setFacts(initialFacts);
              requestNextTurn(initialFacts, transcript, 0, {
                priorFactsChanged: changedShown,
                lifeEvent: lifeEvent.trim() || undefined,
              });
            }}
            nextLabel="Continue"
          />
        </div>
      );
    }

    if (phase === "adaptive-loading") {
      return (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner size="md" />
          <ThinkingNote />
        </div>
      );
    }

    if (phase === "adaptive-question" && currentQuestion) {
      const q = currentQuestion;
      return (
        <div key={q.id}>
          {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}

          {q.kind === "slider" && (
            <>
              <SliderStepInline
                question={q}
                onSubmit={(value, elaboration) => handleAdaptiveAnswer({ kind: "slider", value, elaboration })}
              />
            </>
          )}

          {q.kind === "target-slider" && (
            <TargetSliderStepInline
              question={q}
              range={q.boundTo === "circadianTolerance" ? CIRCADIAN_TOLERANCE_RANGE : ranges[q.boundTo]}
              onSubmit={(value, elaboration) => handleAdaptiveAnswer({ kind: "target-slider", value, elaboration })}
            />
          )}

          {q.kind === "choice" && (
            <div>
              <Heading as="h2" className="text-xl text-ink sm:text-2xl">
                {q.prompt}
              </Heading>
              {q.helpText && <p className="mt-1.5 text-sm text-ink-muted">{q.helpText}</p>}
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {q.options.map((opt, i) => (
                  <SelectableCard
                    key={i}
                    label={opt.label}
                    description={opt.description}
                    selected={choiceSelection === i}
                    onClick={() => setChoiceSelection(i)}
                  />
                ))}
              </div>
              <ElaborationToggle value={choiceElaboration} onChange={setChoiceElaboration} />
              <StepNav
                onNext={() =>
                  choiceSelection !== null &&
                  handleAdaptiveAnswer({
                    kind: "choice",
                    selectedIndex: choiceSelection,
                    elaboration: choiceElaboration.trim() || undefined,
                  })
                }
                nextLabel="Next"
                disabled={choiceSelection === null}
              />
            </div>
          )}

          {q.kind === "free-text" && (
            <div>
              <Heading as="h2" className="text-xl text-ink sm:text-2xl">
                {q.prompt}
              </Heading>
              {q.helpText && <p className="mt-1.5 text-sm text-ink-muted">{q.helpText}</p>}
              <div className="mt-8">
                <FreeTextAnswerBox
                  placeholder={q.placeholder}
                  onSubmit={async (text) => handleAdaptiveAnswer({ kind: "free-text", text })}
                  onSkip={() => handleAdaptiveAnswer({ kind: "skipped" })}
                />
              </div>
            </div>
          )}
        </div>
      );
    }

    return null;
  })();

  const canFinishEarly = phase === "adaptive-loading" || phase === "adaptive-question";
  // Only worth mentioning once wrap_up is even legally reachable (see
  // MIN_TURNS_BEFORE_WRAP) — below that floor the interview keeps going
  // regardless, so a richness nudge here would just be noise.
  const richness = canFinishEarly && turnsUsed >= MIN_TURNS_BEFORE_WRAP ? assessProfileRichness({ discoveredFacts: facts }) : null;

  return (
    <div className="mx-auto w-full max-w-xl">
      <InterviewProgressBar fraction={progress.fraction} label={progressLabel} />

      {showResumePrompt && savedDraft && (
        <div className="mb-4 rounded-xl border border-brand/30 bg-brand-soft/60 p-5">
          <div className="text-sm font-semibold text-ink">Pick up where you left off?</div>
          <p className="mt-1 text-sm text-ink-muted">
            You were partway through &mdash; {savedDraft.turnsUsed} question{savedDraft.turnsUsed === 1 ? "" : "s"} answered.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => resumeSavedDraft(savedDraft)}>Resume</Button>
            <Button
              variant="secondary"
              onClick={() => {
                clearDraft(userId);
                setResumeDismissed(true);
              }}
            >
              Start fresh
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        {canGoBack && (
          <button
            type="button"
            onClick={goBack}
            className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <span aria-hidden>&larr;</span> Back
          </button>
        )}
        {error && phase !== "adaptive-question" && <ErrorBanner className="mb-4">{error}</ErrorBanner>}
        <ScreenTransition screenKey={stepKey} direction={1}>
          {content}
        </ScreenTransition>
      </div>

      {canFinishEarly && (
        <div className="mt-4 text-center">
          {richness && richness.level !== "thorough" && (
            <p className="mb-2 text-xs text-ink-faint">
              {richness.level === "thin"
                ? "Your profile's still on the thinner side — a few more questions would meaningfully sharpen your ranking."
                : "A couple more questions here would sharpen your ranking further, if you've got the time."}
            </p>
          )}
          <button
            type="button"
            onClick={() => finish(facts, transcript)}
            className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            Finish now, see my results
          </button>
        </div>
      )}
    </div>
  );
}

/** A fresh, self-contained draft for one adaptive slider question — keyed by the parent on `question.id`, so a new question always remounts this with a clean neutral default rather than carrying over the previous question's value. */
function SliderStepInline({
  question,
  onSubmit,
}: {
  question: Extract<InterviewQuestion, { kind: "slider" }>;
  onSubmit: (value: number, elaboration?: string) => void;
}) {
  const [value, setValue] = useState(0);
  // A slider that's never been moved still reads as an answer (it sits at "no preference"), so say so — and label the button for what pressing it actually records.
  const [touched, setTouched] = useState(false);
  const [elaboration, setElaboration] = useState("");
  return (
    <div>
      <SliderStep
        config={{
          key: question.boundTo,
          question: question.prompt,
          helpText: question.helpText,
          lowLabel: question.lowLabel,
          highLabel: question.highLabel,
          centerLabel: question.centerLabel,
        }}
        value={value}
        onChange={(v) => {
          setTouched(true);
          setValue(v);
        }}
      />
      {!touched && (
        <p className="mt-3 text-xs text-ink-muted">Not set yet &mdash; drag toward a side, or continue if you have no preference.</p>
      )}
      <ElaborationToggle value={elaboration} onChange={setElaboration} />
      <StepNav
        onNext={() => onSubmit(value, elaboration.trim() || undefined)}
        nextLabel={touched ? "Next" : "No preference \u2014 next"}
      />
    </div>
  );
}

function TargetSliderStepInline({
  question,
  range,
  onSubmit,
}: {
  question: Extract<InterviewQuestion, { kind: "target-slider" }>;
  range: readonly [number, number];
  onSubmit: (value: number | undefined, elaboration?: string) => void;
}) {
  const midpoint = Math.round((range[0] + range[1]) / 2);
  const [value, setValue] = useState<number | undefined>(midpoint);
  // The slider opens at the middle of the pack's range — pressing Next without touching it used to silently record that midpoint as the pilot's answer. Now the button says exactly what it will record.
  const [touched, setTouched] = useState(false);
  const [elaboration, setElaboration] = useState("");
  return (
    <div>
      <TargetSliderStep
        config={{
          key: question.boundTo,
          question: question.prompt,
          helpText: question.helpText ?? "",
          unitSingular: question.unitSingular,
          unitPlural: question.unitPlural,
          formatValue: (v) => String(Math.round(v)),
          step: 1,
        }}
        range={range}
        value={value}
        onChange={(v) => {
          setTouched(true);
          setValue(v);
        }}
      />
      <ElaborationToggle value={elaboration} onChange={setElaboration} />
      <StepNav
        onNext={() => onSubmit(value, elaboration.trim() || undefined)}
        nextLabel={touched || value === undefined ? "Next" : `Use ${value} ${value === 1 ? question.unitSingular : question.unitPlural}`}
      />
    </div>
  );
}

const THINKING_STEPS: { afterMs: number; text: string }[] = [
  { afterMs: 0, text: "Got it — thinking about what to ask next…" },
  { afterMs: 4000, text: "Working out what matters most to you…" },
  { afterMs: 9000, text: "Still working — this one is taking a little longer than usual…" },
];

/** A question takes several seconds to come back; a message that visibly changes reads as progress, one that never changes reads as a hang. */
function ThinkingNote() {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, []);
  const step = [...THINKING_STEPS].reverse().find((t) => elapsedMs >= t.afterMs) ?? THINKING_STEPS[0];
  return (
    <p className="text-sm text-ink-faint" role="status" aria-live="polite">
      {step.text}
    </p>
  );
}
