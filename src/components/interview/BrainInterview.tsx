"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { lookUpFlights } from "@/lib/flights/client";
import { BiddingStoryStep } from "@/components/interview/BiddingStoryStep";
import { CheckInStep } from "@/components/interview/CheckInStep";
import { ChoiceStep } from "@/components/interview/ChoiceStep";
import { CityRatingStep } from "@/components/interview/CityRatingStep";
import { CommuterStep } from "@/components/interview/CommuterStep";
import { FreeTextAnswerBox } from "@/components/interview/FreeTextAnswerBox";
import { InterviewProgress, StepNav } from "@/components/interview/InterviewChrome";
import { LinePairStep } from "@/components/interview/LinePairStep";
import { PriorityReviewStep } from "@/components/interview/PriorityReviewStep";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { parseSeniorityInput, SeniorityStep } from "@/components/interview/SeniorityStep";
import { ThinkingPanel, type LastExchange } from "@/components/interview/ThinkingPanel";
import { TopicSweepStep, uncoveredTopics } from "@/components/interview/TopicSweepStep";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { MicButton } from "@/components/ui/MicButton";
import { StepTransition } from "@/components/ui/StepTransition";
import type { InterviewExchange } from "@/lib/brain/build-model";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { requestModelBuild, requestNextStep, type StepResponse } from "@/lib/brain/client";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { SWEEP_QUESTION, type LinePairCandidate, type ThreadState } from "@/lib/brain/interviewer";
import { pickLinePairs } from "@/lib/brain/line-pairs";
import { topLines, topShift } from "@/lib/brain/ranking-shift";
import { applyPriorityPick, priorityOrderQuestion, priorityOrderTranscript } from "@/lib/brain/priority-order";
import { pilotContextFor } from "@/lib/brain/context";
import { applyPins } from "@/lib/brain/profile-model";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { applyPriorityReview, type PriorityVerdict } from "@/lib/brain/review";
import { cityScoresFromRatings, describeCityRatings, effectiveCityScore, packCityFacts, sentimentFromRating } from "@/lib/city-ratings";
import { resolveBidPosition } from "@/lib/forecast/forecast";
import { buildBrainOutcome } from "@/lib/learning/brain-learning";
import { bidPercentile, commuteGroupOf, seniorityBandOf } from "@/lib/learning/cohort";
import { isLearnablePack } from "@/lib/learning/corrections";
import { postBrainOutcome } from "@/lib/learning/learning-client";
import { parseAirportCode } from "@/lib/interview-story";
import { loadStoryDraft, saveStoryDraft } from "@/lib/interview-draft";
import { prepareMetrics } from "@/lib/metrics/compute";
import { useDictation } from "@/lib/use-speech-to-text";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type CityRating, type CityRatingScore, type CitySentiment, type PreferenceProfile } from "@/types/preferences";

/**
 * The story-driven interview. The pilot tells their bidding story in their
 * own words; the pilot brain reads it (in the background, while they rate
 * their commute and cities) and every question after that comes from what
 * they said — the brain's open threads, their own words, their own pack's
 * real lines. No topic checklist. When their priorities pull against each
 * other it puts two real lines in front of them and asks which they'd bid;
 * those choices tune the weights. One screen near the end catches anything
 * they never raised, then they review their priorities before anything is
 * ranked.
 */

type Phase = "seniority" | "checkin" | "story" | "commuter" | "cities" | "reading" | "asking" | "question" | "sweep" | "building" | "review";

/** A monthly check-in asks at most this many questions about what's new. */
const CHECK_IN_TURNS = 5;

const MAX_TURNS = 22;
/** After the "anything else?" screen, at most this many follow-ups before the interview wraps up. */
const AFTER_SWEEP = 3;
/** Below this many answers the "that's enough" link stays hidden — the brain hasn't had a real chance yet. */
const MIN_TURNS_TO_FINISH = 4;
/** The brain re-reads the whole interview every this many answers (and once more at the end). */
const REBUILD_EVERY = 3;
const MAX_STORY = 12000;
const OPENING_QUESTION = "Walk us through your whole bidding process, start to finish, in your own words.";

interface Snapshot {
  exchanges: InterviewExchange[];
  threads: Record<string, ThreadState>;
  choices: LineChoice[];
  pastTrades: string[];
  question: Extract<StepResponse, { done: false }>;
  turn: number;
}

interface DraftState {
  version: 1;
  savedAt: number;
  phase: "question" | "sweep";
  exchanges: InterviewExchange[];
  threads: Record<string, ThreadState>;
  choices: LineChoice[];
  pastTrades?: string[];
  model: PilotModel | null;
  question: Extract<StepResponse, { done: false }> | null;
  turn: number;
  isCommuter: boolean | null;
  commuteFrom: string;
  hasCrashPad: boolean | null;
  seniorityText: string;
  cityRatings: Record<string, CityRating>;
  cityPreferences: Record<string, CitySentiment>;
  sweepDone: boolean;
  turnLimit?: number;
}

const draftKey = (userId: string | null, packId: string) => `line-select:brain-interview:${userId ?? "guest"}:${packId}:v1`;
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function loadDraftState(userId: string | null, packId: string): DraftState | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId, packId));
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftState;
    if (d.version !== 1 || Date.now() - d.savedAt > DRAFT_MAX_AGE_MS || !Array.isArray(d.exchanges)) return null;
    return d;
  } catch {
    return null;
  }
}

/** The optional "why" under a multiple-choice answer — typed or dictated, like every other answer in the interview. */
function ChoiceNote({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const dictation = useDictation(value, onChange);
  return (
    <div className="mt-4">
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder="Want to explain? (optional)"
          aria-label="Explain your answer"
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 pr-11 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
      </div>
      {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
    </div>
  );
}

interface BrainInterviewProps {
  bidPack: BidPack;
  priorProfile: PreferenceProfile | null;
  userId: string | null;
  onComplete: (profile: PreferenceProfile) => void;
}

export function BrainInterview({ bidPack, priorProfile, userId, onComplete }: BrainInterviewProps) {
  const hasSeniorityStep = !!bidPack.seniorityList && bidPack.seniorityList.length > 0;
  /**
   * A pilot the brain already knows, on a new pack: a short check-in that starts from everything they said last time,
   * rather than the whole interview again. Same pack (a retake) starts over.
   */
  const lastTime = priorProfile?.pilotModel && priorProfile.brainInterview ? priorProfile.brainInterview : null;
  const [checkIn, setCheckIn] = useState(() => !!lastTime && lastTime.packId !== bidPack.id);
  const afterSeniority: Phase = checkIn ? "checkin" : "story";
  const [phase, setPhase] = useState<Phase>(hasSeniorityStep ? "seniority" : afterSeniority);
  const [error, setError] = useState<string | null>(null);

  // Opening steps.
  const [seniorityText, setSeniorityText] = useState(priorProfile?.seniorityNumber ? String(priorProfile.seniorityNumber) : "");
  const [storyText, setStoryText] = useState(() => loadStoryDraft(userId, bidPack.id));
  useEffect(() => {
    const t = setTimeout(() => saveStoryDraft(userId, bidPack.id, storyText), 400);
    return () => clearTimeout(t);
  }, [userId, bidPack.id, storyText]);
  const [isCommuter, setIsCommuter] = useState<boolean | null>(priorProfile?.isCommuter ?? null);
  const [commuteFrom, setCommuteFrom] = useState(priorProfile?.commuteFrom ?? "");
  const [hasCrashPad, setHasCrashPad] = useState<boolean | null>(priorProfile?.hasCrashPad ?? null);
  const [cityRatings, setCityRatings] = useState<Record<string, CityRating>>(() => ({ ...(priorProfile?.cityRatings ?? {}) }));
  const [cityPreferences, setCityPreferences] = useState<Record<string, CitySentiment>>(() => ({ ...(priorProfile?.cityPreferences ?? {}) }));
  /** Cities the story itself rated, as the brain read it — shown as such on the city step until the pilot changes them. */
  const [storySuggested, setStorySuggested] = useState<Record<string, CitySentiment>>({});
  const [homeCity, setHomeCity] = useState<string | null>(null);
  const cityFacts = useMemo(() => packCityFacts(bidPack), [bidPack]);

  // The interview itself.
  const [exchanges, setExchanges] = useState<InterviewExchange[]>(() => (checkIn && lastTime ? lastTime.exchanges : []));
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [choices, setChoices] = useState<LineChoice[]>([]);
  /** The trade behind every line pair already put to the pilot, so no trade is asked about more than twice. */
  const [pastTrades, setPastTrades] = useState<string[]>([]);
  const [model, setModel] = useState<PilotModel | null>(() => (checkIn ? (priorProfile?.brainInterview?.reviewedModel ?? priorProfile?.pilotModel ?? null) : null));
  const [question, setQuestion] = useState<Extract<StepResponse, { done: false }> | null>(null);
  const [turn, setTurn] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [sweepDone, setSweepDone] = useState(false);
  /** The interview's question limit — lowered once the sweep is done, so it wraps up with a few follow-ups at most. */
  const [turnLimit, setTurnLimit] = useState(MAX_TURNS);
  const turnLimitRef = useRef(MAX_TURNS);
  turnLimitRef.current = turnLimit;
  const [reviewModel, setReviewModel] = useState<PilotModel | null>(null);
  /** The final read with city grades in, before choice fitting — what the pilot's review is applied to and what later choices refit from. */
  const [ratedModel, setRatedModel] = useState<PilotModel | null>(null);
  const [choiceSelection, setChoiceSelection] = useState<number | null>(null);
  const [choiceNote, setChoiceNote] = useState("");

  // The brain's background reads: one in flight at a time, the newest result wins.
  const buildRef = useRef<{ promise: Promise<PilotModel | null>; upTo: number } | null>(null);
  const builtUpTo = useRef(0);
  const modelRef = useRef<PilotModel | null>(null);
  modelRef.current = model;
  const tradesRef = useRef<string[]>([]);
  tradesRef.current = pastTrades;
  // How many of the pilot's top-10 lines each re-read changed — the interviewer wraps up once answers stop moving it.
  const topRef = useRef<string[] | null>(null);
  const shiftsRef = useRef<number[]>([]);

  // The pack brief and measurements are worked out once, the first time they're needed.
  const briefRef = useRef<string | null>(null);
  const pm = useMemo(() => prepareMetrics(bidPack), [bidPack]);
  const packBrief = () => (briefRef.current ??= buildPackBrief(bidPack, pm));

  // The interview only renders once the bid pack has loaded from this device, so local storage is always there to read.
  const [resume, setResume] = useState<DraftState | null>(() => (typeof window === "undefined" ? null : loadDraftState(userId, bidPack.id)));

  const pilotContext = () =>
    pilotContextFor(bidPack, { isCommuter, commuteFrom, hasCrashPad }) +
    (checkIn ? " This is a monthly check-in: the earlier part of the interview is from last month, on a different bid pack — its line numbers don't exist in this pack; everything else they said still stands unless they say it changed." : "");

  const cohort = () => ({ base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, commute: commuteGroupOf(isCommuter) });

  const periodLabel = (() => {
    if (!bidPack.bidPeriodStart) return bidPack.month;
    const start = new Date(`${bidPack.bidPeriodStart}T12:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + bidPack.bidPeriodDays - 1);
    const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${f(start)} – ${f(end)}`;
  })();

  /** Starts a full read of the interview so far, unless one already covers it. */
  function startBuild(all: InterviewExchange[]): Promise<PilotModel | null> {
    if (buildRef.current && buildRef.current.upTo >= all.length) return buildRef.current.promise;
    const upTo = all.length;
    const promise = requestModelBuild({ packBrief: packBrief(), pilotContext: pilotContext(), cohort: cohort(), exchanges: all, prior: modelRef.current })
      .then((m) => {
        if (upTo >= builtUpTo.current) {
          builtUpTo.current = upTo;
          const rated = applyCityRatings(m, finalCityRatings());
          const top = topLines(bidPack, rated, pm);
          if (topRef.current) shiftsRef.current = [...shiftsRef.current, topShift(topRef.current, top)];
          topRef.current = top;
          setModel(rated);
          // New threads start open; ones the interview already worked on keep their state.
          setThreads((prev) => {
            const next = { ...prev };
            for (const t of rated.threads) next[t.id] ??= { status: t.status, timesAsked: t.timesAsked };
            return next;
          });
          // Cities the story named, rated for them on the city step until they say otherwise.
          seedCitiesFromModel(rated);
        }
        return m;
      })
      .catch(() => null)
      .finally(() => {
        if (buildRef.current?.upTo === upTo) buildRef.current = null;
      });
    buildRef.current = { promise, upTo };
    return promise;
  }

  function seedCitiesFromModel(m: PilotModel) {
    // The brain records city feelings either as graded scores or as "more/less time in these cities" — read both.
    const scores: Record<string, number> = {};
    for (const c of m.criteria) {
      if (c.params?.cityScores) Object.assign(scores, c.params.cityScores);
      else if (c.params?.cities && (c.shape.kind === "more" || c.shape.kind === "less"))
        for (const code of c.params.cities) scores[code] ??= c.shape.kind === "more" ? 1 : -1;
    }
    const suggested: Record<string, CitySentiment> = {};
    for (const [code, v] of Object.entries(scores)) {
      const s = sentimentFromRating(v >= 0.5 ? 1 : v <= -0.5 ? -1 : 0);
      if (s && cityFacts.some((c) => c.code === code)) suggested[code] = s;
    }
    if (!Object.keys(suggested).length) return;
    setStorySuggested((p) => ({ ...suggested, ...p }));
    // Only cities the pilot hasn't rated themselves.
    setCityPreferences((prev) => ({ ...suggested, ...prev }));
  }

  function finalCityRatings(): Record<string, CityRating> {
    const out: Record<string, CityRating> = {};
    for (const c of cityFacts) {
      const score = effectiveCityScore(c.code, cityRatings, cityPreferences);
      if (score !== 0) out[c.code] = { ...cityRatings[c.code], score };
    }
    return out;
  }

  function submitStory() {
    const text = storyText.trim();
    if (!text) return;
    const first = [{ turn: 0, question: OPENING_QUESTION, answer: text }];
    setExchanges(first);
    void startBuild(first);
    setPhase("commuter");
  }

  /** The check-in's two answers join last month's record; the city step comes next. */
  function submitCheckIn(changed: string, dates: string) {
    const start = lastTime?.exchanges ?? [];
    setExchanges([
      ...start,
      { turn: start.length, question: `Monthly check-in (${bidPack.month} bid pack): has anything changed since last month?`, answer: changed || "Nothing has changed." },
      { turn: start.length + 1, question: `Monthly check-in: any dates you need off in this bid period (${periodLabel})?`, answer: dates || "No specific dates this month." },
    ]);
    setPhase("cities");
  }

  /** Check-in: this pack's city grades join the record, the brain re-reads everything against the new pack, then a few questions about what's new. */
  async function beginCheckInQuestions() {
    const all = [...exchanges, { turn: exchanges.length, question: `This month's pack (${bidPack.month}): how do you feel about each layover city?`, answer: describeCityRatings(finalCityRatings()) || "No strong feelings about any city." }];
    setExchanges(all);
    setSweepDone(true);
    turnLimitRef.current = CHECK_IN_TURNS;
    setTurnLimit(CHECK_IN_TURNS);
    setPhase("reading");
    setError(null);
    await startBuild(all);
    await askNext(all, threads, choices, 0, true);
  }

  function startOverInstead() {
    setCheckIn(false);
    setExchanges([]);
    setModel(null);
    modelRef.current = null;
    topRef.current = null;
    shiftsRef.current = [];
    setPhase("story");
  }

  /** The commute and city answers join the record, then the questions begin once the brain has read the story. */
  async function beginQuestions() {
    const home = parseAirportCode(commuteFrom);
    const ratingsText = describeCityRatings(finalCityRatings());
    const base = exchanges.filter((e) => e.turn === 0);
    const opening: InterviewExchange[] = [
      ...base,
      { turn: base.length, question: "Do you commute to base, or live locally?", answer: isCommuter === true ? `I commute in${home ? ` from ${home}` : ""}.${hasCrashPad === false ? " No crash pad." : hasCrashPad ? " I have a crash pad." : ""}` : isCommuter === false ? "I live locally." : "(skipped)" },
      { turn: base.length + 1, question: "How do you feel about each layover city in your pack?", answer: ratingsText || "No strong feelings about any city." },
    ];
    setExchanges(opening);
    setPhase("reading");
    setError(null);
    // With no story there's nothing to read yet; with one, wait for the read started when it was sent.
    if (!buildRef.current && !modelRef.current) await startBuild(opening);
    else if (buildRef.current) await buildRef.current.promise;
    await askNext(opening, threads, choices, 0, sweepDone);
  }

  async function askNext(all: InterviewExchange[], th: Record<string, ThreadState>, ch: LineChoice[], t: number, swept: boolean) {
    setPhase("asking");
    setError(null);
    const m = modelRef.current;
    const compared = new Set(ch.map((c) => `${c.preferred}|${c.other}`));
    for (const e of all) for (const x of e.question.matchAll(/Line (\d{3,5}) vs Line (\d{3,5})/g)) compared.add(`${x[1]}|${x[2]}`);
    // The first question, asked the same way for everyone: which of their top priorities they'd give up last — in
    // their words, before any line choice can reorder them (see lib/brain/priority-order.ts).
    const priority = t === 0 && !checkIn ? priorityOrderQuestion(m) : null;
    if (priority) {
      setQuestion({ done: false, settled: [], threadId: null, kind: "choice", prompt: priority.prompt, helpText: priority.helpText, options: priority.options, priorityIds: priority.criterionIds, transcript: priorityOrderTranscript(priority) });
      setChoiceSelection(null);
      setChoiceNote("");
      setPhase("question");
      return;
    }
    const linePairs: LinePairCandidate[] = m ? pickLinePairs(bidPack, m, pm, compared, 3, tradesRef.current) : [];
    try {
      const step = await requestNextStep({ packBrief: packBrief(), pilotContext: pilotContext(), cohort: cohort(), exchanges: all, model: m, threads: th, linePairs, turn: t, maxTurns: turnLimitRef.current, rankingShifts: shiftsRef.current });
      const settledThreads = { ...th };
      for (const id of step.settled) settledThreads[id] = { ...(settledThreads[id] ?? { timesAsked: 0 }), status: "settled" };
      if (step.done) {
        setThreads(settledThreads);
        if (!swept && uncoveredTopics(m).length > 0) setPhase("sweep");
        else void finishInterview(all, ch);
        return;
      }
      if (step.threadId) settledThreads[step.threadId] = { status: settledThreads[step.threadId]?.status ?? "open", timesAsked: (settledThreads[step.threadId]?.timesAsked ?? 0) + 1 };
      setThreads(settledThreads);
      setQuestion(step);
      setChoiceSelection(null);
      setChoiceNote("");
      setPhase("question");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t get the next question.");
      setPhase("question");
    }
  }

  async function answer(text: string, choice: LineChoice | null = null) {
    if (!question) return;
    setHistory((h) => [...h, { exchanges, threads, choices, pastTrades, question, turn }]);
    const asked = question.kind === "line-pair" && question.pair ? `${question.prompt} [Line ${question.pair.a} vs Line ${question.pair.b}: ${question.pair.tension}]` : (question.transcript ?? question.prompt);
    // Their priority pick counts at once, so the next questions and line choices already work from it.
    if (question.priorityIds && choiceSelection !== null && modelRef.current) {
      const picked = applyPriorityPick(modelRef.current, question.priorityIds[choiceSelection] ?? null);
      modelRef.current = picked;
      setModel(picked);
    }
    const all = [...exchanges, { turn: exchanges.length, question: asked, answer: text }];
    const ch = choice ? [...choices, choice] : choices;
    const nextTurn = turn + 1;
    if (question.kind === "line-pair" && question.pair?.trade) {
      tradesRef.current = [...pastTrades, question.pair.trade];
      setPastTrades(tradesRef.current);
    }
    let th = threads;
    if (text === "(skipped)" && question.threadId) th = { ...threads, [question.threadId]: { ...(threads[question.threadId] ?? { timesAsked: 1 }), status: "parked" } };
    setExchanges(all);
    setChoices(ch);
    setTurn(nextTurn);
    setThreads(th);
    if (all.length - builtUpTo.current >= REBUILD_EVERY && !buildRef.current) void startBuild(all);
    await askNext(all, th, ch, nextTurn, sweepDone);
  }

  function goBack() {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setExchanges(last.exchanges);
    setThreads(last.threads);
    setChoices(last.choices);
    setPastTrades(last.pastTrades);
    tradesRef.current = last.pastTrades;
    setQuestion(last.question);
    setTurn(last.turn);
    setChoiceSelection(null);
    setChoiceNote("");
    setError(null);
    setPhase("question");
  }

  async function submitSweep(picked: string[], note: string) {
    setSweepDone(true);
    if (!picked.length && !note) {
      void finishInterview(exchanges, choices);
      return;
    }
    const all = [...exchanges, { turn: exchanges.length, question: SWEEP_QUESTION, answer: [picked.length ? `These matter to me too: ${picked.join(", ")}.` : "", note].filter(Boolean).join(" ") }];
    setExchanges(all);
    // A follow-up or two on what they picked, then done.
    const limit = Math.min(MAX_TURNS, turn + AFTER_SWEEP);
    turnLimitRef.current = limit;
    setTurnLimit(limit);
    await askNext(all, threads, choices, turn, true);
  }

  async function finishInterview(all: InterviewExchange[], ch: LineChoice[]) {
    setPhase("building");
    setError(null);
    try {
      if (buildRef.current) await buildRef.current.promise;
      const built = await requestModelBuild({ packBrief: packBrief(), pilotContext: pilotContext(), cohort: cohort(), exchanges: all, prior: modelRef.current });
      const rated = applyCityRatings(built, finalCityRatings());
      // Priorities the pilot set by hand on their priorities page still hold — shown that way in the review.
      const fitted = applyPins(fitWeightsToChoices(bidPack, rated, ch, pm).model, priorProfile?.brainInterview?.pins ?? {});
      setRatedModel(rated);
      setModel(fitted);
      setReviewModel(fitted);
      setPhase("review");
      // A commuter's real airline flights for their top lines, looked up while they review — the results pick it up.
      void lookUpFlights(bidPack, fitted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t build your priorities.");
    }
  }

  function confirmReview(verdicts: Record<string, PriorityVerdict | undefined>) {
    if (!reviewModel || !ratedModel) return;
    // The pilot's verdicts land on the model before fitting, so later choices and edits refit from what they confirmed.
    const reviewed = applyPriorityReview(ratedModel, verdicts);
    const pins = priorProfile?.brainInterview?.pins ?? {};
    const finalModel = applyPins(fitWeightsToChoices(bidPack, reviewed, choices, pm).model, pins);
    const ratings = finalCityRatings();
    const prefs: Record<string, CitySentiment> = {};
    for (const [code, r] of Object.entries(ratings)) {
      const s = sentimentFromRating(r.score);
      if (s) prefs[code] = s;
    }
    // A clean profile: the older interview's facts, targets and weights would otherwise add their own dealbreakers and
    // notes to lines this model ranks. Only what's still the pilot's carries over.
    const profile: PreferenceProfile = {
      ...(priorProfile?.strategyReactions ? { strategyReactions: priorProfile.strategyReactions } : {}),
      weights: { ...DEFAULT_WEIGHTS },
      deepRoundCompleted: false,
      tradeoffAnswers: [],
      explicitTargets: {},
      isCommuter,
      commuteFrom: parseAirportCode(commuteFrom),
      hasCrashPad,
      seniorityNumber: parseSeniorityInput(seniorityText),
      cityPreferences: prefs,
      cityRatings: ratings,
      completedAt: new Date().toISOString(),
      implicitWeights: {},
      implicitConfidence: {},
      discoveredFacts: [],
      interviewTranscript: [],
      pilotModel: finalModel,
      brainInterview: { exchanges, choices, reviewedModel: reviewed, packId: bidPack.id, ...(Object.keys(pins).length ? { pins } : {}) },
    };
    try {
      window.localStorage.removeItem(draftKey(userId, bidPack.id));
    } catch {}
    // What the fleet learns from this interview: the shape of the finished model, city grades and review verdicts — never the pilot's words.
    if (isLearnablePack(bidPack)) {
      const list = bidPack.seniorityList ?? [];
      const seniority = parseSeniorityInput(seniorityText);
      const position = seniority !== null && list.length ? resolveBidPosition(list, seniority) : null;
      postBrainOutcome(
        buildBrainOutcome({
          month: bidPack.month,
          cohort: { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, commute: commuteGroupOf(isCommuter), seniority: seniorityBandOf(position ? bidPercentile(position.bidNumber, list.length) : null) },
          checkIn,
          questions: turn,
          choices: choices.length,
          model: finalModel,
          cityScores: cityScoresFromRatings(ratings),
          review: Object.entries(verdicts).flatMap(([id, v]) => {
            const metric = ratedModel.criteria.find((c) => c.id === id)?.metric;
            return v && metric ? [{ metric, verdict: v }] : [];
          }),
        })
      );
    }
    onComplete(profile);
  }

  // Progress worth resuming: saved after every answer.
  useEffect(() => {
    if ((phase !== "question" && phase !== "sweep") || exchanges.length === 0) return;
    const d: DraftState = { version: 1, savedAt: Date.now(), phase, exchanges, threads, choices, pastTrades, model, question, turn, isCommuter, commuteFrom, hasCrashPad, seniorityText, cityRatings, cityPreferences, sweepDone, turnLimit };
    try {
      window.localStorage.setItem(draftKey(userId, bidPack.id), JSON.stringify(d));
    } catch {}
  }, [phase, exchanges, threads, choices, pastTrades, model, question, turn, isCommuter, commuteFrom, hasCrashPad, seniorityText, cityRatings, cityPreferences, sweepDone, turnLimit, userId, bidPack.id]);

  function resumeDraft(d: DraftState) {
    setExchanges(d.exchanges);
    setThreads(d.threads);
    setChoices(d.choices);
    setPastTrades(d.pastTrades ?? []);
    tradesRef.current = d.pastTrades ?? [];
    setModel(d.model);
    builtUpTo.current = d.model ? d.exchanges.length : 0;
    setQuestion(d.question);
    setTurn(d.turn);
    setIsCommuter(d.isCommuter);
    setCommuteFrom(d.commuteFrom);
    setHasCrashPad(d.hasCrashPad);
    setSeniorityText(d.seniorityText);
    setCityRatings(d.cityRatings);
    setCityPreferences(d.cityPreferences);
    setSweepDone(d.sweepDone);
    turnLimitRef.current = d.turnLimit ?? MAX_TURNS;
    setTurnLimit(turnLimitRef.current);
    setResume(null);
    if (d.phase === "sweep") setPhase("sweep");
    else if (d.question) setPhase("question");
    else void askNext(d.exchanges, d.threads, d.choices, d.turn, d.sweepDone);
  }

  // ----- Rendering -----

  const opening = (checkIn ? ["seniority", "checkin", "cities"] : ["seniority", "story", "commuter", "cities"]) as readonly Phase[];
  const stepTotal = opening.length - (hasSeniorityStep ? 0 : 1);
  const stepIndex = Math.max(0, opening.indexOf(phase as (typeof opening)[number]) - (hasSeniorityStep ? 0 : 1));
  const eyebrow = (label: string) => `Step ${stepIndex + 1} of ${stepTotal} · ${label}`;
  const inOpening = (opening as readonly string[]).includes(phase);
  const progress = inOpening ? (stepIndex / stepTotal) * 0.2 : phase === "review" ? 0.97 : phase === "building" || phase === "sweep" ? 0.9 : 0.2 + Math.min(0.65, (turn / turnLimit) * 0.9);
  const lastAnswer = exchanges.at(-1);
  const lastExchange: LastExchange | null = lastAnswer && lastAnswer.turn > 0 && !lastAnswer.question.startsWith("How do you feel about each layover") ? { question: lastAnswer.question.replace(/ \[Line .*\]$/, ""), answer: lastAnswer.answer } : null;
  const questionEyebrow = `Question ${turn + 1} · from your story`;

  const content = (() => {
    if (phase === "seniority") {
      const typed = seniorityText.trim();
      return (
        <div>
          <SeniorityStep value={seniorityText} onChange={setSeniorityText} list={bidPack.seniorityList ?? []} seat={bidPack.seat} eyebrow={eyebrow("Your place in the bid")} />
          <StepNav onNext={() => setPhase(afterSeniority)} nextLabel={typed === "" ? "Skip for now" : "Next"} disabled={typed !== "" && parseSeniorityInput(typed) === null} />
        </div>
      );
    }
    if (phase === "checkin" && model) {
      return <CheckInStep model={model} periodLabel={periodLabel} eyebrow="Monthly check-in" onContinue={submitCheckIn} onStartOver={startOverInstead} />;
    }
    if (phase === "story") {
      return (
        <BiddingStoryStep
          value={storyText}
          onChange={setStoryText}
          onSubmit={submitStory}
          onSkip={() => {
            setExchanges([]);
            setPhase("commuter");
          }}
          busy={false}
          error={null}
          maxLength={MAX_STORY}
          eyebrow={eyebrow("Your story")}
        />
      );
    }
    if (phase === "commuter") {
      return (
        <CommuterStep value={isCommuter} onChange={setIsCommuter} base={bidPack.base} eyebrow={eyebrow("Your commute")}>
          {isCommuter === true && (
            <div className="mt-6 rounded-xl border border-hairline bg-canvas/50 p-4">
              <label htmlFor="brain-commute-from" className="mb-1 block text-sm font-medium text-ink">
                Where do you commute from?
              </label>
              <p className="mb-2 text-xs text-ink-muted">The airport code — it lets us count your real time away from home, and backup flights.</p>
              <input
                id="brain-commute-from"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={3}
                value={commuteFrom}
                onChange={(e) => setCommuteFrom(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3))}
                placeholder="e.g. CLT"
                className="mb-5 block w-28 rounded-lg border border-hairline bg-canvas/60 px-3 py-2 font-mono text-base uppercase tracking-wider text-readout placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
              <div className="text-sm font-medium text-ink">Got a crash pad in domicile?</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  [true, "Yes, I’ve got a place"],
                  [false, "No crash pad"],
                ] as const).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={hasCrashPad === v}
                    onClick={() => setHasCrashPad(v)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${hasCrashPad === v ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <StepNav
            onNext={() => {
              const home = isCommuter ? parseAirportCode(commuteFrom) : null;
              if (home && cityFacts.some((c) => c.code === home)) {
                setCityPreferences((prev) => (prev[home] ? prev : { ...prev, [home]: "love" }));
                setHomeCity(home);
              } else setHomeCity(null);
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
          <CityRatingStep
            cities={cityFacts}
            ratings={cityRatings}
            sentiments={cityPreferences}
            onRate={(code, score: CityRatingScore | 0) => {
              setCityRatings((prev) => {
                const next = { ...prev };
                if (score === 0) delete next[code];
                else next[code] = { ...prev[code], score };
                return next;
              });
              setCityPreferences((prev) => {
                const next = { ...prev };
                const s = sentimentFromRating(score);
                if (s) next[code] = s;
                else delete next[code];
                return next;
              });
            }}
            onReasons={(code, reasons) => {
              const implied = effectiveCityScore(code, cityRatings, cityPreferences);
              if (implied !== 0) setCityRatings((prev) => ({ ...prev, [code]: { ...prev[code], score: prev[code]?.score ?? implied, reasons } }));
            }}
            onNote={(code, note) => {
              const implied = effectiveCityScore(code, cityRatings, cityPreferences);
              if (implied !== 0) setCityRatings((prev) => ({ ...prev, [code]: { ...prev[code], score: prev[code]?.score ?? implied, note } }));
            }}
            eyebrow={eyebrow("Layover cities")}
            fromStory={Object.keys(storySuggested).filter((c) => c !== homeCity && !cityRatings[c] && cityPreferences[c] === storySuggested[c])}
            homeCity={homeCity && cityPreferences[homeCity] === "love" ? homeCity : undefined}
          />
          <StepNav onNext={() => void (checkIn ? beginCheckInQuestions() : beginQuestions())} nextLabel="Continue" />
        </div>
      );
    }
    if (phase === "reading") {
      return <ThinkingPanel briefing={exchanges.some((e) => e.turn === 0 && e.question === OPENING_QUESTION) ? "Reading your story against every line in your pack — this takes about a minute, once." : "Getting your first question ready."} />;
    }
    if (phase === "asking") return <ThinkingPanel lastExchange={lastExchange} />;
    if (phase === "building") {
      return (
        <div>
          <ThinkingPanel briefing="Reading everything you’ve said one last time and turning it into your priorities — about a minute." />
          {error && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => void finishInterview(exchanges, choices)}>Try again</Button>
            </div>
          )}
        </div>
      );
    }
    if (phase === "sweep") return <TopicSweepStep topics={uncoveredTopics(model)} eyebrow="Almost done" onContinue={(p, n) => void submitSweep(p, n)} />;
    if (phase === "review" && reviewModel) return <PriorityReviewStep model={reviewModel} eyebrow="Your priorities" onConfirm={confirmReview} />;
    if (phase === "question") {
      if (!question) {
        return (
          <div className="py-8 text-center">
            <Button onClick={() => void askNext(exchanges, threads, choices, turn, sweepDone)}>Try again</Button>
          </div>
        );
      }
      const q = question;
      // What it took from their last answer, said the way a colleague would before asking the next thing.
      const ack = q.ack ? <p className="animate-fade-in mb-4 text-[15px] leading-relaxed text-ink-muted">{q.ack}</p> : null;
      if (q.kind === "line-pair" && q.pair) {
        return (
          <div key={`${q.pair.a}-${q.pair.b}-${turn}`}>
            {ack}
            <LinePairStep
              prompt={q.prompt}
              helpText={q.helpText}
              eyebrow={questionEyebrow}
              pair={q.pair}
              bidPack={bidPack}
              onAnswer={(choice, text) => answer(text, choice)}
              onSkip={() => void answer("(skipped)")}
            />
          </div>
        );
      }
      if (q.kind === "choice" && q.options) {
        return (
          <div key={turn}>
            {ack}
            <ChoiceStep prompt={q.prompt} helpText={q.helpText} eyebrow={questionEyebrow} options={q.options.map((label) => ({ label }))} selected={choiceSelection} onSelect={setChoiceSelection}>
              <ChoiceNote value={choiceNote} onChange={setChoiceNote} />
              <StepNav
                onNext={() => choiceSelection !== null && void answer(`${q.options![choiceSelection]}${choiceNote.trim() ? `. ${choiceNote.trim()}` : ""}`)}
                nextLabel="Next"
                disabled={choiceSelection === null}
              />
            </ChoiceStep>
          </div>
        );
      }
      return (
        <div key={turn}>
          {ack}
          <QuestionPrompt eyebrow={questionEyebrow} title={q.prompt} help={q.helpText} />
          <RevealControls title={q.prompt} className="mt-8">
            <FreeTextAnswerBox onSubmit={(text) => answer(text)} onSkip={() => void answer("(skipped)")} />
          </RevealControls>
        </div>
      );
    }
    return null;
  })();

  const canGoBack = phase === "question" && history.length > 0;
  const backInOpening: Phase | null =
    phase === "story" || phase === "checkin" ? (hasSeniorityStep ? "seniority" : null) : phase === "commuter" ? "story" : phase === "cities" ? (checkIn ? "checkin" : "commuter") : null;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <InterviewProgress fraction={progress} left={inOpening ? "Getting started" : phase === "review" ? "Your priorities" : `${turn} answered`} right={inOpening ? (checkIn ? "About 3–5 min" : "About 15–20 min") : phase === "review" ? "Last step" : checkIn ? "Monthly check-in" : "Story-driven"} />

      {resume && inOpening && (
        <div className="panel-glass glow-soft mb-5 p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Saved progress</div>
          <div className="mt-1.5 font-display text-lg font-semibold text-ink">Pick up where you left off?</div>
          <p className="mt-1 text-sm text-ink-muted">
            You were partway through — {resume.turn} question{resume.turn === 1 ? "" : "s"} answered.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => resumeDraft(resume)}>Resume</Button>
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  window.localStorage.removeItem(draftKey(userId, bidPack.id));
                } catch {}
                setResume(null);
              }}
            >
              Start fresh
            </Button>
          </div>
        </div>
      )}

      <div className="panel-glass p-6 sm:p-10">
        {(canGoBack || backInOpening) && (
          <button
            type="button"
            onClick={() => (canGoBack ? goBack() : backInOpening && setPhase(backInOpening))}
            className="-ml-1 mb-5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m5 5l-5-5 5-5" />
            </svg>
            Back
          </button>
        )}
        {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}
        <StepTransition screenKey={`${phase}-${turn}`} direction={1}>
          {content}
        </StepTransition>
      </div>

      {phase === "question" && turn >= MIN_TURNS_TO_FINISH && (
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => (sweepDone || uncoveredTopics(model).length === 0 ? void finishInterview(exchanges, choices) : setPhase("sweep"))}
            className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            That&rsquo;s enough — build my priorities
          </button>
        </div>
      )}
    </div>
  );
}
