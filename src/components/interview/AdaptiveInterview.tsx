"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { FlightPathProgress } from "@/components/ui/FlightPathProgress";
import { MicButton } from "@/components/ui/MicButton";
import { NumberTicker } from "@/components/ui/NumberTicker";
import { StepTransition } from "@/components/ui/StepTransition";
import { parseSeniorityInput, SeniorityStep } from "@/components/interview/SeniorityStep";
import { BiddingStoryStep } from "@/components/interview/BiddingStoryStep";
import { ChoiceStep, isTypingTarget } from "@/components/interview/ChoiceStep";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { StoryReviewStep } from "@/components/interview/StoryReviewStep";
import { resolveBidPosition } from "@/lib/forecast/forecast";
import { assumedFact } from "@/lib/learning/assumed-facts";
import { bidPercentile, commuteGroupOf, seniorityBandOf, type Cohort } from "@/lib/learning/cohort";
import { buildInterviewOutcome } from "@/lib/learning/interview-outcome";
import { isLearnablePack } from "@/lib/learning/corrections";
import { fetchInterviewPlan, insightsFromPlan, postInterviewOutcome, type InterviewPlan } from "@/lib/learning/learning-client";
import { ThinkingPanel, type LastExchange } from "@/components/interview/ThinkingPanel";
import { CityPreferenceStep } from "@/components/interview/CityPreferenceStep";
import { CommuterStep } from "@/components/interview/CommuterStep";
import { FreeTextAnswerBox } from "@/components/interview/FreeTextAnswerBox";
import { ReturningPilotCheckStep } from "@/components/interview/ReturningPilotCheckStep";
import { SliderStep } from "@/components/interview/SliderStep";
import { TargetSliderStep } from "@/components/interview/TargetSliderStep";
import {
  HARD_CEILING_TURNS,
  MIN_TURNS_BEFORE_WRAP,
  minTurnsBeforeWrap,
  openEssentials,
  applyProfileUpdates,
  assessProfileRichness,
  buildTurnRequest,
  detectContradiction,
  finalizeAdaptiveProfile,
  applicableExplicitWeightIds,
  packHasHotelStandby,
  uncoveredExplicitWeightIds,
  type ContradictionFlag,
} from "@/lib/interview-engine";
import { clearDraft, loadDraft, saveDraft, type InterviewDraft } from "@/lib/interview-draft";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { answerElaboration, describeAnswer, questionTopicLabel } from "@/lib/interview-display";
import { computeInterviewProgress } from "@/lib/interview-progress";
import { homeCityReasonFact, mergeStoryAndCityFacts, parseAirportCode, storyCitySentiments } from "@/lib/interview-story";
import { cycleCitySentiment } from "@/lib/preference-logic";
import { useDictation } from "@/lib/use-speech-to-text";
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

/** How long the "profile locked in" moment holds before the review screen — long enough to land, short enough never to feel like a wait. */
const FINISH_HOLD_MS = 1500;

interface FinishSummary {
  learned: number;
  topicsCovered: number;
  topicsTotal: number;
  inYourWords: number;
  dealbreakers: number;
}

/** The end of the interview: the aircraft at its destination, and a real tally of what the conversation produced. */
function FinishPanel({ summary }: { summary: FinishSummary | null }) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center py-6 text-center" role="status" aria-live="polite">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Interview complete</div>
      <h2 className="mt-2.5 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Locking in your profile</h2>
      {summary && (
        <dl className="mt-8 grid w-full max-w-md grid-cols-3 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline">
          {[
            ["Things learned", <NumberTicker key="l" value={summary.learned} duration={0.9} />],
            ["Topics covered", (
              <span key="t">
                <NumberTicker value={summary.topicsCovered} duration={0.9} />
                <span className="text-ink-faint">/{summary.topicsTotal}</span>
              </span>
            )],
            ["In your words", <NumberTicker key="w" value={summary.inYourWords} duration={0.9} />],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-panel px-3 py-4">
              <dd className="text-readout text-3xl font-semibold">{value}</dd>
              <dt className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</dt>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-6 text-sm text-ink-muted">
        {summary && summary.dealbreakers > 0
          ? `${summary.dealbreakers} dealbreaker${summary.dealbreakers === 1 ? "" : "s"} noted. `
          : ""}
        Next: a quick look at what we heard, before anything is ranked.
      </p>
    </div>
  );
}

type Phase = "seniority" | "bidding-story" | "commuter" | "cities" | "returning-check" | "adaptive-loading" | "adaptive-question" | "finishing";

/** Matches `MAX_BID_STORY_LENGTH` in `/api/interview-bidding-story/route.ts` — generous enough for genuinely exhaustive detail, still a sane ceiling for one LLM call and one localStorage-bound profile. */
const MAX_BID_STORY_LENGTH = 12000;

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

/**
 * The step's continue button — and Enter, anywhere on the page that isn't a
 * text box, presses it. Only one step is on screen at a time, so only one
 * of these is ever listening.
 */
function StepNav({ onNext, nextLabel, disabled }: { onNext: () => void; nextLabel: string; disabled?: boolean }) {
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  });
  useEffect(() => {
    if (disabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      // An answer option (a choice card, a number stop) with focus: Enter on
      // the one already picked continues — that's what the on-screen hint
      // promises right after clicking it — while Enter on another one just
      // picks it, the way a radio button normally behaves.
      if (target?.getAttribute("role") === "radio") {
        if (target.getAttribute("aria-checked") !== "true") return;
        e.preventDefault();
        onNextRef.current();
        return;
      }
      // Any other focused button handles its own Enter; a text box keeps Enter for typing.
      if (isTypingTarget(target) || target?.tagName === "BUTTON" || target?.tagName === "A") return;
      e.preventDefault();
      onNextRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);
  return (
    <div className="mt-10 flex items-center justify-end">
      <Button onClick={onNext} disabled={disabled} className="sm:min-w-[9rem] sm:px-6">
        {nextLabel}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5l5 5-5 5" />
        </svg>
      </Button>
    </div>
  );
}

/**
 * Progress drawn as the flight it is: from the brief to your ranking, the
 * aircraft moving along as you answer — with the honest readout underneath
 * (topics actually covered, a real estimate of time left).
 */
function InterviewProgress({ fraction, left, right }: { fraction: number; left: string; right?: string }) {
  return (
    <div className="mb-6">
      <FlightPathProgress fraction={fraction} label="Interview progress" waypoints={3} />
      <div className="mt-1.5 flex items-center justify-between gap-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
        <span className="whitespace-nowrap">{left}</span>
        {right && <span className="whitespace-nowrap text-right">{right}</span>}
      </div>
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
  const dictation = useDictation(value, onChange);
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
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Optional — anything about this answer worth knowing"
          rows={2}
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 pr-11 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        {dictation.supported && (
          <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />
        )}
      </div>
      {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
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
  // Only worth asking when the pack lists the pilots bidding this seat — that list is what gives the number meaning.
  const hasSeniorityStep = !!bidPack.seniorityList && bidPack.seniorityList.length > 0;
  const preStepCount = (hasReturningCheck ? 3 : 2) + (hasSeniorityStep ? 1 : 0) + 1; // +1 for the bidding-story step, always shown
  const priorFactsForCheck = useMemo(
    () => (hasReturningCheck ? priorProfile!.discoveredFacts.filter((f) => !isCitySentimentFact(f)) : []),
    [hasReturningCheck, priorProfile]
  );
  const priorTopFacts = useMemo(
    () => topPriorFacts(priorFactsForCheck, TOP_PRIOR_FACTS_SHOWN),
    [priorFactsForCheck]
  );

  const firstPhase: Phase = hasSeniorityStep ? "seniority" : "bidding-story";
  const [phase, setPhase] = useState<Phase>(firstPhase);
  const [seniorityText, setSeniorityText] = useState(priorProfile?.seniorityNumber ? String(priorProfile.seniorityNumber) : "");
  const [bidStoryText, setBidStoryText] = useState("");
  const [bidStoryBusy, setBidStoryBusy] = useState(false);
  const [bidStoryError, setBidStoryError] = useState<string | null>(null);
  // A returning pilot starts from last cycle's answers — still shown, so a
  // change (a move, a new crash pad) is one tap, but never re-asked blank.
  const [isCommuter, setIsCommuter] = useState<boolean | null>(priorProfile?.isCommuter ?? null);
  const [hasCrashPad, setHasCrashPad] = useState<boolean | null>(priorProfile?.hasCrashPad ?? null);
  /**
   * What the fleet has learned for pilots in this group (see
   * `lib/learning/`): answers it can assume, its predictions for the rest,
   * where pilots like this differ. Read from a ref inside turn requests so a
   * request never sees a stale copy.
   */
  const planRef = useRef<InterviewPlan | null>(null);
  /** Where a commuter commutes from (airport code) — prefilled from the story or last cycle, editable on the commuter step. */
  const [commuteFrom, setCommuteFrom] = useState(priorProfile?.commuteFrom ?? "");
  /** The commute-from city, when it's one of this pack's layovers and was marked as loved on the commuter step's Next. */
  const [homeCity, setHomeCity] = useState<string | null>(null);
  const [cityPreferences, setCityPreferences] = useState<Record<string, CitySentiment>>(() => ({
    ...(priorProfile?.cityPreferences ?? {}),
  }));
  const [changedFactIds, setChangedFactIds] = useState<Set<string>>(new Set());
  const [lifeEvent, setLifeEvent] = useState("");
  const [pendingContradiction, setPendingContradiction] = useState<ContradictionFlag | null>(null);

  // Kept apart from `facts` until the cities step: the loop's starting facts
  // are built from both (see `mergeStoryAndCityFacts`), and going back to
  // the story and resubmitting replaces these rather than piling up copies.
  const [storyFacts, setStoryFacts] = useState<PreferenceFact[]>([]);
  /** Showing what was taken from the story, for the pilot to confirm or correct, before moving on. */
  const [storyReview, setStoryReview] = useState(false);
  const [facts, setFacts] = useState<PreferenceFact[]>([]);
  const [transcript, setTranscript] = useState<InterviewTurnRecord[]>([]);
  const [turnsUsed, setTurnsUsed] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  /** What the interview took from the last answer, said back above the question it led to — keyed to that question so going back never shows a stale one. */
  const [heard, setHeard] = useState<{ questionId: string; text: string } | null>(null);
  const [choiceSelection, setChoiceSelection] = useState<number | null>(null);
  const [choiceElaboration, setChoiceElaboration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const finishingRef = useRef(false);
  const [finishSummary, setFinishSummary] = useState<FinishSummary | null>(null);

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
    } else if (phase === "commuter") {
      setPhase("bidding-story");
    } else if (phase === "bidding-story" && hasSeniorityStep) {
      setPhase("seniority");
    }
  }

  function resumeSavedDraft(d: InterviewDraft) {
    setIsCommuter(d.isCommuter);
    setHasCrashPad(d.hasCrashPad);
    if (d.commuteFrom) setCommuteFrom(d.commuteFrom);
    if (d.seniorityNumber) setSeniorityText(String(d.seniorityNumber));
    if (d.bidStoryText) setBidStoryText(d.bidStoryText);
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
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearDraft(userId);
    const profile = finalizeAdaptiveProfile({
      facts: finalFacts,
      transcript: finalTranscript,
      isCommuter,
      hasCrashPad,
      commuteFrom: parseAirportCode(commuteFrom),
      seniorityNumber: parseSeniorityInput(seniorityText),
      cityPreferencesSeed: cityPreferences,
      priorProfile,
    });
    // What the fleet learns from this interview: where each answer landed and
    // how each question went — never the pilot's words (see InterviewOutcome).
    const plan = planRef.current;
    if (isLearnablePack(bidPack)) postInterviewOutcome(
      buildInterviewOutcome({
        profile,
        transcript: finalTranscript,
        cohort: cohortFor(isCommuter),
        month: bidPack.month,
        modelVersion: plan?.version ?? null,
        predictions: plan?.predictions ?? {},
        wrapped: finalTranscript.length < HARD_CEILING_TURNS,
      })
    );
    const applicable = applicableExplicitWeightIds(hasStandby).length;
    setFinishSummary({
      learned: profile.discoveredFacts.length,
      topicsCovered: applicable - uncoveredExplicitWeightIds(finalFacts, hasStandby).length,
      topicsTotal: applicable,
      inYourWords: profile.discoveredFacts.filter((f) => f.kind === "qualitative").length,
      dealbreakers: profile.discoveredFacts.filter((f) => f.severity === "dealbreaker").length,
    });
    setPhase("finishing");
    // The profile is ready the instant it's computed; this beat exists only
    // so the end of the interview lands instead of cutting away, and it's
    // skipped entirely under reduced motion.
    window.setTimeout(() => onComplete(profile), reduceMotion ? 0 : FINISH_HOLD_MS);
  }

  /**
   * Reads the pilot's bidding-story answer once, extracts whatever it can
   * (see `runBiddingStoryExtraction`), and seeds the result into `facts`
   * before the adaptive loop's first turn — the same pre-loop-seeding
   * pattern the city picker already uses (`factsFromCityPreferences`), so a
   * topic this narrative already covered simply won't show up in
   * `uncoveredExplicitWeightIds` once the loop starts. Never blocks the
   * interview on failure: an error here still lets the pilot continue with
   * a plain, unenriched interview, with the raw text they wrote preserved
   * so they can retry without retyping it.
   */
  async function submitBiddingStory() {
    const trimmed = bidStoryText.trim();
    if (!trimmed) return;
    setBidStoryBusy(true);
    setBidStoryError(null);
    try {
      const res = await fetch("/api/interview-bidding-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidStoryText: trimmed, grounding, base: bidPack.base, aircraft: bidPack.aircraft, isCommuter, cityCodes: allCities }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setBidStoryError(body?.error ?? "Couldn't read that just now — you can try again, or skip and answer as you go instead.");
        return;
      }
      const { profileUpdates, commuterStatus, commuteFrom: storyCommuteFrom } = (await res.json()) as {
        profileUpdates: PreferenceFactUpdate[];
        commuterStatus?: boolean | null;
        commuteFrom?: string | null;
      };
      if (storyCommuteFrom) setCommuteFrom((prev) => prev || storyCommuteFrom);
      // The next screen asks this anyway — when the story already said, it
      // arrives answered for the pilot to confirm, never over their own pick.
      if (typeof commuterStatus === "boolean") setIsCommuter((prev) => prev ?? commuterStatus);
      const extracted = applyProfileUpdates([], profileUpdates);
      // Cities the story named show up on the picker already marked; a
      // resubmitted story first takes back the marks its previous version made.
      const previousPicks = storyCitySentiments(storyFacts);
      const nextPicks = storyCitySentiments(extracted);
      setCityPreferences((prev) => {
        const next = { ...prev };
        for (const [code, sentiment] of Object.entries(previousPicks)) if (next[code] === sentiment) delete next[code];
        return { ...next, ...nextPicks };
      });
      setStoryFacts(extracted);
      if (extracted.length > 0) setStoryReview(true);
      else setPhase("commuter");
    } catch {
      setBidStoryError("Couldn't reach the interview service. Check your connection and try again, or skip for now.");
    } finally {
      setBidStoryBusy(false);
    }
  }

  /** This pilot's learning group — the same coarse facts every bid pack prints. */
  function cohortFor(commuter: boolean | null): Cohort {
    const seniority = parseSeniorityInput(seniorityText);
    const list = bidPack.seniorityList;
    const percentile = seniority !== null && list?.length ? bidPercentile(resolveBidPosition(list, seniority).bidNumber, list.length) : null;
    return { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, commute: commuteGroupOf(commuter), seniority: seniorityBandOf(percentile) };
  }

  /**
   * Starts the question loop. First asks what the fleet has learned for
   * pilots like this one (a moment at most — without it the interview just
   * asks everything): answers this group gives so consistently that they're
   * assumed rather than asked are added as visible, changeable facts, unless
   * the pilot already covered them.
   */
  async function beginLoop(startFacts: PreferenceFact[], extras?: { priorFactsChanged?: PreferenceFact[]; lifeEvent?: string }) {
    setPhase("adaptive-loading");
    const seniority = parseSeniorityInput(seniorityText);
    const list = bidPack.seniorityList;
    const plan = !isLearnablePack(bidPack) ? null : await fetchInterviewPlan({
      base: bidPack.base,
      aircraft: bidPack.aircraft,
      seat: bidPack.seat,
      isCommuter,
      percentile: seniority !== null && list?.length ? bidPercentile(resolveBidPosition(list, seniority).bidNumber, list.length) : null,
    });
    planRef.current = plan;
    let withAssumed = startFacts;
    if (plan?.version) {
      const covered = new Set(startFacts.flatMap((f) => (f.measurable?.type === "explicit-weight" ? [f.measurable.key as string] : [])));
      const assumed = plan.assume
        .filter((a) => !covered.has(a.dim) && (a.dim !== "hotelStandby" || hasStandby))
        .map((a) => assumedFact({ ...a, modelVersion: plan.version! }));
      if (assumed.length) {
        withAssumed = [...startFacts, ...assumed];
        setFacts(withAssumed);
      }
    }
    requestNextTurn(withAssumed, transcript, 0, extras);
  }

  async function requestNextTurn(
    nextFacts: PreferenceFact[],
    nextTranscript: InterviewTurnRecord[],
    nextTurnsUsed: number,
    extras?: { priorFactsChanged?: PreferenceFact[]; lifeEvent?: string; final?: boolean }
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
        bidStory: bidStoryText.trim() || undefined,
        seniorityKnown: parseSeniorityInput(seniorityText) !== null,
        commuteFrom: isCommuter ? parseAirportCode(commuteFrom) ?? undefined : undefined,
        populationInsights: insightsFromPlan(planRef.current),
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

      if (turn.action === "wrap_up" || !turn.question || extras?.final) {
        finish(mergedFacts, nextTranscript);
        return;
      }
      setCurrentQuestion(turn.question);
      setHeard(turn.heard ? { questionId: turn.question.id, text: turn.heard } : null);
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

    // At the hard ceiling the interview ends no matter what the model would
    // ask next, but this last answer still gets read — finishing straight
    // away used to drop whatever the pilot said on their final question.
    requestNextTurn(facts, nextTranscript, nextTurnsUsed, { final: nextTurnsUsed >= HARD_CEILING_TURNS });
  }

  const seniorityOffset = hasSeniorityStep ? 1 : 0;
  const preStepsDone =
    phase === "seniority"
      ? 0
      : phase === "bidding-story"
        ? seniorityOffset
        : phase === "commuter"
          ? seniorityOffset + 1
          : phase === "cities"
            ? seniorityOffset + 2
            : phase === "returning-check"
              ? seniorityOffset + 3
              : preStepCount;
  const progress = computeInterviewProgress({
    turnsUsed,
    uncoveredCount: uncoveredExplicitWeightIds(facts, hasStandby).length,
    hasStandby,
    preStepsDone,
    preStepTotal: preStepCount,
    minTurns: minTurnsBeforeWrap(facts),
    openEssentialsCount: openEssentials({ transcript, facts, isCommuter }).length,
  });
  const inSetup =
    phase === "seniority" || phase === "bidding-story" || phase === "commuter" || phase === "cities" || phase === "returning-check";
  const progressLeft =
    phase === "finishing" ? "Arrived" : inSetup ? "Getting started" : `${progress.topicsCovered} of ${progress.topicsTotal} topics covered`;
  const progressRight =
    phase === "finishing" ? "Your ranking" : inSetup ? "About 8\u201310 min" : `About ${progress.minutesLeft} min left`;

  /** "Step 2 of 4 · Your story" — where the pilot is in the setup steps; short enough for one line on a phone. */
  const preStepEyebrow = (label: string) => `Step ${Math.min(preStepCount, preStepsDone + 1)} of ${preStepCount} \u00b7 ${label}`;
  const topic = currentQuestion ? questionTopicLabel(currentQuestion) : null;
  const questionEyebrow = currentQuestion ? `Question ${turnsUsed + 1}${topic ? ` \u00b7 ${topic}` : ""}` : undefined;
  // Before the first question there's no answer to echo — say what the interview is starting from instead.
  // City picks are counted once, as cities, even when the story is where they came from.
  const storyCount = facts.filter(
    (f) => f.source.kind === "seed-question" && f.source.questionKey === "bidding-story" && f.measurable?.type !== "city-sentiment"
  ).length;
  const pickedCities = Object.keys(cityPreferences).length;
  const briefing =
    storyCount + pickedCities > 0
      ? `Starting from ${[
          storyCount > 0 ? `${storyCount} thing${storyCount === 1 ? "" : "s"} from your story` : null,
          pickedCities > 0 ? `${pickedCities} cit${pickedCities === 1 ? "y" : "ies"} you flagged` : null,
        ]
          .filter(Boolean)
          .join(" and ")}. Anything already covered won\u2019t be asked again.`
      : "Building your first question from your bid pack.";
  const lastTurn = transcript.at(-1);
  const lastExchange: LastExchange | null = lastTurn
    ? {
        question: lastTurn.question.prompt,
        answer: describeAnswer(lastTurn.question, lastTurn.answer),
        elaboration: answerElaboration(lastTurn.answer),
      }
    : null;

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
      commuteFrom: parseAirportCode(commuteFrom) ?? undefined,
      seniorityNumber: parseSeniorityInput(seniorityText),
      bidStoryText: bidStoryText.trim() || undefined,
      cityPreferences,
      facts,
      transcript,
      turnsUsed,
      currentQuestion,
    });
  }, [phase, currentQuestion, userId, bidPack.id, isCommuter, hasCrashPad, commuteFrom, seniorityText, bidStoryText, cityPreferences, facts, transcript, turnsUsed]);

  // After a resume there's no in-memory history, so Back is only offered from the very first question (to the pre-steps) or once new answers exist to undo — never in a way that would wipe resumed progress.
  const canGoBack =
    (phase === "adaptive-question" && !!currentQuestion && (historyCount > 0 || turnsUsed === 0)) ||
    phase === "returning-check" ||
    phase === "cities" ||
    phase === "commuter" ||
    (phase === "bidding-story" && hasSeniorityStep);
  const showResumePrompt = !!savedDraft && !resumeDismissed && phase === firstPhase;

  const stepKey =
    phase === "finishing"
      ? "finishing"
      : phase === "seniority"
      ? "seniority"
      : phase === "bidding-story"
      ? "bidding-story"
      : phase === "commuter"
      ? "commuter"
      : phase === "cities"
        ? "cities"
        : phase === "returning-check"
          ? "returning-check"
          : currentQuestion
            ? `q-${currentQuestion.id}`
            : phase;

  // StepTransition drifts in from a direction, but there's no single
  // "going forward" setPhase call to hook — forward moves happen from a
  // dozen different handlers, while `goBack` is the one and only path
  // backward. Rather than touch every forward call site, derive direction
  // from whether this step's key has been seen before in this session:
  // landing on a key again (goBack restoring an earlier question, or
  // stepping back through the pre-steps) reads as backward, anything new
  // reads as forward. Updated via setState directly in the render body —
  // React's own documented pattern for adjusting state when a prop/derived
  // value changes (not a ref: that's restricted to effects/handlers here).
  // React re-renders immediately on this branch before committing anything,
  // so the direction used below is always correct for the render that
  // actually reaches the screen, with no extra paint or lag.
  const [prevStepKey, setPrevStepKey] = useState(stepKey);
  const [visitedStepKeys, setVisitedStepKeys] = useState<ReadonlySet<string>>(() => new Set([stepKey]));
  let stepDirection: 1 | -1 | 0 = 1;
  if (stepKey !== prevStepKey) {
    stepDirection = visitedStepKeys.has(stepKey) ? -1 : 1;
    setVisitedStepKeys((prev) => new Set(prev).add(stepKey));
    setPrevStepKey(stepKey);
  }

  const content = (() => {
    if (phase === "seniority" && bidPack.seniorityList) {
      const typed = seniorityText.trim();
      return (
        <div>
          <SeniorityStep
            value={seniorityText}
            onChange={setSeniorityText}
            list={bidPack.seniorityList}
            seat={bidPack.seat}
            eyebrow={preStepEyebrow("Your place in the bid")}
          />
          <StepNav onNext={() => setPhase("bidding-story")} nextLabel={typed === "" ? "Skip for now" : "Next"} disabled={typed !== "" && parseSeniorityInput(typed) === null} />
        </div>
      );
    }

    if (phase === "bidding-story" && storyReview) {
      return (
        <StoryReviewStep
          facts={storyFacts}
          eyebrow={preStepEyebrow("Your story")}
          onRemove={(id) => {
            const gone = storyFacts.find((f) => f.id === id);
            setStoryFacts((prev) => prev.filter((f) => f.id !== id));
            // A city taken off here comes off the city screen's prefill too.
            if (gone?.measurable?.type === "city-sentiment") {
              const { code, sentiment } = gone.measurable;
              setCityPreferences((prev) => {
                if (prev[code] !== sentiment) return prev;
                const next = { ...prev };
                delete next[code];
                return next;
              });
            }
          }}
          onRestore={(restored) => {
            setStoryFacts((prev) => [...prev, ...restored]);
            setCityPreferences((prev) => ({ ...prev, ...storyCitySentiments(restored) }));
          }}
          onConfirm={() => setPhase("commuter")}
          onEdit={() => setStoryReview(false)}
        />
      );
    }

    if (phase === "bidding-story") {
      return (
        <BiddingStoryStep
          value={bidStoryText}
          onChange={setBidStoryText}
          onSubmit={submitBiddingStory}
          onSkip={() => {
            // Skipping after an earlier submit means none of it should count.
            const previousPicks = storyCitySentiments(storyFacts);
            setCityPreferences((prev) =>
              Object.fromEntries(Object.entries(prev).filter(([code, sentiment]) => previousPicks[code] !== sentiment))
            );
            setStoryFacts([]);
            setStoryReview(false);
            setPhase("commuter");
          }}
          busy={bidStoryBusy}
          error={bidStoryError}
          maxLength={MAX_BID_STORY_LENGTH}
          eyebrow={preStepEyebrow("Your story")}
        />
      );
    }

    if (phase === "commuter") {
      return (
        <CommuterStep value={isCommuter} onChange={setIsCommuter} base={bidPack.base} eyebrow={preStepEyebrow("Your commute")}>
          {isCommuter === true && (
            <div className="mt-6 rounded-xl border border-hairline bg-canvas/50 p-4">
              <label htmlFor="commute-from" className="mb-1 block text-sm font-medium text-ink">
                Where do you commute from?
              </label>
              <p className="mb-2 text-xs text-ink-muted">The airport code — if it&rsquo;s a layover in this pack, a trip that overnights there gets you a night at home.</p>
              <input
                id="commute-from"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={3}
                value={commuteFrom}
                onChange={(e) => setCommuteFrom(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3))}
                placeholder="e.g. CLT"
                className="mb-5 block w-28 rounded-lg border border-hairline bg-canvas/60 px-3 py-2 font-mono text-base uppercase tracking-wider text-readout placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
              <div className="text-sm font-medium text-ink">Got a crash pad in domicile?</div>
              <p className="mt-1 text-xs text-ink-muted">
                Worth factoring in &mdash; without a place to stage between duty days, an extra separate trip costs you more than
                it would otherwise.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  [true, "Yes, I\u2019ve got a place"],
                  [false, "No crash pad"],
                ] as const).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={hasCrashPad === v}
                    onClick={() => setHasCrashPad(v)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
                      hasCrashPad === v
                        ? "glow-soft border-accent bg-accent-soft text-accent"
                        : "border-hairline bg-surface/70 text-ink-muted hover:border-border-strong hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <StepNav
            onNext={() => {
              // A layover in the city they commute from is a night at home — marked as loved on the city screen, where they can still change it.
              const home = isCommuter ? parseAirportCode(commuteFrom) : null;
              if (home && allCities.includes(home)) {
                setCityPreferences((prev) => (prev[home] ? prev : { ...prev, [home]: "love" }));
                setHomeCity(home);
              } else {
                setHomeCity(null);
              }
              setPhase("cities");
            }}
            nextLabel="Next"
            disabled={isCommuter === null}
          />
        </CommuterStep>
      );
    }

    if (phase === "cities") {
      return (
        <div>
          <CityPreferenceStep
            cities={allCities}
            preferences={cityPreferences}
            onToggleCity={(code) => setCityPreferences((prev) => cycleCitySentiment(prev, code))}
            eyebrow={preStepEyebrow("Layover cities")}
            fromStory={Object.entries(storyCitySentiments(storyFacts))
              .filter(([code, sentiment]) => cityPreferences[code] === sentiment && code !== homeCity)
              .map(([code]) => code)}
            homeCity={homeCity && cityPreferences[homeCity] === "love" ? homeCity : undefined}
          />
          <StepNav
            onNext={() => {
              const merged = mergeStoryAndCityFacts(storyFacts, cityPreferences);
              const startFacts =
                homeCity && cityPreferences[homeCity] === "love" && !merged.some((f) => f.cityReason?.code === homeCity)
                  ? [...merged, homeCityReasonFact(homeCity)]
                  : merged;
              setFacts(startFacts);
              if (hasReturningCheck) {
                setPhase("returning-check");
              } else {
                void beginLoop(startFacts);
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
              void beginLoop(initialFacts, {
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
      return <ThinkingPanel lastExchange={lastExchange} briefing={briefing} />;
    }

    if (phase === "finishing") {
      return <FinishPanel summary={finishSummary} />;
    }

    if (phase === "adaptive-question" && currentQuestion) {
      const q = currentQuestion;
      return (
        <div key={q.id}>
          {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}
          {heard?.questionId === q.id && (
            <p className="mb-5 flex items-start gap-2.5 text-sm leading-relaxed text-ink-muted">
              <span className="mt-0.5 shrink-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-good">Noted</span>
              <span>{heard.text}</span>
            </p>
          )}

          {q.kind === "slider" && (
            <>
              <SliderStepInline
                question={q}
                eyebrow={questionEyebrow}
                onSubmit={(value, elaboration) => handleAdaptiveAnswer({ kind: "slider", value, elaboration })}
              />
            </>
          )}

          {q.kind === "target-slider" && (
            <TargetSliderStepInline
              question={q}
              eyebrow={questionEyebrow}
              range={q.boundTo === "circadianTolerance" ? CIRCADIAN_TOLERANCE_RANGE : ranges[q.boundTo]}
              onSubmit={(value, elaboration) => handleAdaptiveAnswer({ kind: "target-slider", value, elaboration })}
            />
          )}

          {q.kind === "choice" && (
            <ChoiceStep
              eyebrow={questionEyebrow}
              prompt={q.prompt}
              helpText={q.helpText}
              options={q.options}
              selected={choiceSelection}
              onSelect={setChoiceSelection}
            >
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
            </ChoiceStep>
          )}

          {q.kind === "free-text" && (
            <div>
              <QuestionPrompt eyebrow={questionEyebrow} title={q.prompt} help={q.helpText} />
              <RevealControls title={q.prompt} className="mt-8">
                <FreeTextAnswerBox
                  placeholder={q.placeholder}
                  onSubmit={async (text) => handleAdaptiveAnswer({ kind: "free-text", text })}
                  onSkip={() => handleAdaptiveAnswer({ kind: "skipped" })}
                />
              </RevealControls>
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
    <div className="mx-auto w-full max-w-2xl">
      <InterviewProgress fraction={phase === "finishing" ? 1 : progress.fraction} left={progressLeft} right={progressRight} />

      {showResumePrompt && savedDraft && (
        <div className="panel-glass glow-soft mb-5 p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Saved progress</div>
          <div className="mt-1.5 font-display text-lg font-semibold text-ink">Pick up where you left off?</div>
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

      <div className="panel-glass p-6 sm:p-10">
        {canGoBack && (
          <button
            type="button"
            onClick={goBack}
            className="-ml-1 mb-5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m5 5l-5-5 5-5" />
            </svg>
            Back
          </button>
        )}
        {error && phase !== "adaptive-question" && <ErrorBanner className="mb-4">{error}</ErrorBanner>}
        <StepTransition screenKey={stepKey} direction={stepDirection}>
          {content}
        </StepTransition>
      </div>

      {canFinishEarly && (
        <div className="mt-5 text-center">
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
  eyebrow,
}: {
  question: Extract<InterviewQuestion, { kind: "slider" }>;
  onSubmit: (value: number, elaboration?: string) => void;
  eyebrow?: string;
}) {
  const [value, setValue] = useState(0);
  // A slider that's never been moved still reads as an answer (it sits at "no preference"), so say so — and label the button for what pressing it actually records.
  const [touched, setTouched] = useState(false);
  const [elaboration, setElaboration] = useState("");
  return (
    <div>
      <SliderStep
        eyebrow={eyebrow}
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
  eyebrow,
}: {
  question: Extract<InterviewQuestion, { kind: "target-slider" }>;
  range: readonly [number, number];
  onSubmit: (value: number | undefined, elaboration?: string) => void;
  eyebrow?: string;
}) {
  const midpoint = Math.round((range[0] + range[1]) / 2);
  const [value, setValue] = useState<number | undefined>(midpoint);
  // The slider opens at the middle of the pack's range — pressing Next without touching it used to silently record that midpoint as the pilot's answer. Now the button says exactly what it will record.
  const [touched, setTouched] = useState(false);
  const [elaboration, setElaboration] = useState("");
  return (
    <div>
      <TargetSliderStep
        eyebrow={eyebrow}
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
