"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { namedDomicile } from "@/lib/domicile-name";
import { lookUpFlights } from "@/lib/flights/client";
import { BiddingStoryStep } from "@/components/interview/BiddingStoryStep";
import { CheckInStep } from "@/components/interview/CheckInStep";
import { ChoiceStep } from "@/components/interview/ChoiceStep";
import { CityRatingStep } from "@/components/interview/CityRatingStep";
import { commuterPrompt, CommuterStep } from "@/components/interview/CommuterStep";
import { MinHomeHoursPicker, minHomeHoursSentence } from "@/components/interview/MinHomeHoursPicker";
import { FreeTextAnswerBox } from "@/components/interview/FreeTextAnswerBox";
import { InterviewProgress, StepNav } from "@/components/interview/InterviewChrome";
import { LinePairStep } from "@/components/interview/LinePairStep";
import { TripSortStep } from "@/components/interview/TripSortStep";
import { PriorityReviewStep } from "@/components/interview/PriorityReviewStep";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { parseSeniorityInput, SeniorityStep } from "@/components/interview/SeniorityStep";
import { ThinkingPanel, type LastExchange } from "@/components/interview/ThinkingPanel";
import { TopicSweepStep, uncoveredTopics } from "@/components/interview/TopicSweepStep";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { NoteBox } from "@/components/ui/NoteBox";
import { StepTransition } from "@/components/ui/StepTransition";
import type { InterviewExchange } from "@/lib/brain/build-model";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { withHomeFacts } from "@/lib/brain/model-upgrade";
import { carriedOver } from "@/lib/brain/quick-brief";
import { requestModelBuild, requestNextStep, type StepResponse } from "@/lib/brain/client";
import { fitTripWeights, fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { askedTripScreens, choicesFromGrades, pickTripScreen, shareForeseen, tripGradesAnswer, tripGradesTranscript, wantsAnotherScreen, type TripGradeScreen } from "@/lib/brain/trip-sort";
import { nextCommuteQuestion } from "@/lib/brain/commute-questions";
import { askedDealbreakers, dealbreakerQuestion } from "@/lib/brain/dealbreakers";
import { nextHubTurnQuestion } from "@/lib/brain/hub-turn-question";
import { isSweepQuestion, minTurnsFor, SWEEP_QUESTION } from "@/lib/brain/interview-pace";
import type { LinePairCandidate, ThreadState } from "@/lib/brain/interviewer";
import { pickLinePairs } from "@/lib/brain/line-pairs";
import { pickQuestionExamples } from "@/lib/brain/question-examples";
import { QuestionExamples } from "@/components/interview/QuestionExamples";
import { topLines, topShift } from "@/lib/brain/ranking-shift";
import { applyPriorityPick, priorityOrderQuestion, priorityOrderTranscript } from "@/lib/brain/priority-order";
import { pilotContextFor } from "@/lib/brain/context";
import { applyPins } from "@/lib/brain/profile-model";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { applyPriorityReview, type PriorityVerdict } from "@/lib/brain/review";
import { cityScoresFromRatings, describeCityRatings, effectiveCityScore, markCityUntried, packCityFacts, rateCity, rateCityHotel, rateCitySeason, saysMore, sentimentFromRating } from "@/lib/city-ratings";
import { resolveBidPosition } from "@/lib/forecast/forecast";
import { buildBrainOutcome } from "@/lib/learning/brain-learning";
import { bidPercentile, commuteGroupOf, seniorityBandOf } from "@/lib/learning/cohort";
import { isLearnablePack } from "@/lib/learning/corrections";
import { postBrainOutcome } from "@/lib/learning/learning-client";
import { parseAirportCode } from "@/lib/interview-story";
import { loadStoryDraft, saveStoryDraft } from "@/lib/interview-draft";
import { clearServerDraft, fetchServerDraft, saveServerDraft } from "@/lib/interview-draft-sync";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice, PilotModel, TripChoice } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type CityRating, type CityRatingScore, type CitySentiment, type PreferenceProfile } from "@/types/preferences";
import { isPackId, legacyPackIdFor, packIdFor } from "@/lib/pack-id";

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
/** The check-in's two questions as they begin, and what's recorded for a box left blank. */
const CHECK_IN_CHANGED_Q = "Monthly check-in (";
const CHECK_IN_DATES_Q = "Monthly check-in: any dates you need off";
const NOTHING_CHANGED = "Nothing has changed.";
const NO_DATES = "No specific dates this month.";

/**
 * A safety net, not a target: the interviewer decides when it has learned enough (see `rankingHasSettled` and the
 * interviewer's own judgment), and a pilot with a long, detailed story gets more questions than one with a short one.
 */
const MAX_TURNS = 40;
/** After the "anything else?" screen, at most this many follow-ups before the interview wraps up. */
const AFTER_SWEEP = 5;
/** Below this many answers the "that's enough" link stays hidden — the brain hasn't had a real chance yet. */
const MIN_TURNS_TO_FINISH = 4;
/** The brain re-reads the whole interview every this many answers (and once more at the end). */
const REBUILD_EVERY = 3;
const MAX_STORY = 12000;
const OPENING_QUESTION = "Walk us through your whole bidding process, start to finish, in your own words.";
/**
 * When they leave the city screen as it is. Not "no strong feelings": their story may have rated cities that the
 * screen didn't show yet (the story is still being read while they get there), and the interviewer would then ask
 * about a contradiction they never made.
 */
const NO_CITY_RATINGS = "(Didn't rate any cities on the city screen. What I said about cities in my story still stands.)";

/**
 * How much of past months a check-in carries forward: under the brain routes' limit of 80 exchanges
 * (`lib/server/brain-input.ts`), with room for the check-in's own three steps and its questions.
 */
const CARRY_LIMIT = 80 - 3 - CHECK_IN_TURNS - 2;

/**
 * Last month's record for a check-in. Every check-in adds to it, so after a few months it would pass the routes'
 * limit and every read would fail: the first interview (the story and everything after it) is kept whole, then the
 * latest check-ins that fit, numbered afresh.
 */
function carryForward(exchanges: InterviewExchange[], limit = CARRY_LIMIT): InterviewExchange[] {
  if (exchanges.length <= limit) return exchanges;
  const firstCheckIn = exchanges.findIndex((e) => e.question.startsWith("Monthly check-in"));
  const original = exchanges.slice(0, firstCheckIn === -1 ? exchanges.length : firstCheckIn).slice(0, limit);
  const room = limit - original.length;
  const latest = room > 0 ? exchanges.slice(original.length).slice(-room) : [];
  return [...original, ...latest].map((e, i) => ({ ...e, turn: i }));
}

interface Snapshot {
  exchanges: InterviewExchange[];
  threads: Record<string, ThreadState>;
  choices: LineChoice[];
  tripChoices: TripChoice[];
  pastTrades: string[];
  question: Extract<StepResponse, { done: false }>;
  turn: number;
  /** The model as it stood before this answer, and how much of the interview it had read. */
  model: PilotModel | null;
  builtUpTo: number;
}

interface DraftState {
  version: 1;
  savedAt: number;
  phase: "question" | "sweep";
  exchanges: InterviewExchange[];
  threads: Record<string, ThreadState>;
  choices: LineChoice[];
  tripChoices?: TripChoice[];
  pastTrades?: string[];
  model: PilotModel | null;
  question: Extract<StepResponse, { done: false }> | null;
  turn: number;
  isCommuter: boolean | null;
  commuteFrom: string;
  hasCrashPad: boolean | null;
  minHomeHours?: number | null;
  seniorityText: string;
  cityRatings: Record<string, CityRating>;
  cityPreferences: Record<string, CitySentiment>;
  sweepDone: boolean;
  turnLimit?: number;
  /** Whether it's a check-in; a draft from before this was saved counts as one when last month's record says so. */
  checkIn?: boolean;
}

const draftKey = (userId: string | null, packId: string) => `line-select:brain-interview:${userId ?? "guest"}:${packId}:v1`;
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A draft worth offering: the right shape, and under a day old. */
function usableDraft(d: DraftState | null): DraftState | null {
  return d && d.version === 1 && typeof d.savedAt === "number" && Date.now() - d.savedAt <= DRAFT_MAX_AGE_MS && Array.isArray(d.exchanges) ? d : null;
}

function loadDraftState(userId: string | null, packId: string): DraftState | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId, packId));
    return raw ? usableDraft(JSON.parse(raw) as DraftState) : null;
  } catch {
    return null;
  }
}

/** The optional "why" under a multiple-choice answer — typed or dictated, like every other answer in the interview. */
function ChoiceNote({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <NoteBox value={value} onChange={onChange} placeholder="Want to explain? (optional)" ariaLabel="Explain your answer" className="mt-4" />;
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
  // A quick brief told the brain too little to skip the interview on: they get the whole thing.
  const lastTime = priorProfile?.pilotModel && priorProfile.brainInterview && priorProfile.source !== "quick" ? priorProfile.brainInterview : null;
  // A new month's pack (its id before ids named the aircraft still counts as this pack).
  const [checkIn, setCheckIn] = useState(() => !!lastTime && !isPackId(lastTime.packId, bidPack));
  // For the steps that run before a re-render: resuming a draft asks its next question straight away.
  const checkInRef = useRef(checkIn);
  checkInRef.current = checkIn;
  const afterSeniority: Phase = checkIn ? "checkin" : "story";
  const [phase, setPhase] = useState<Phase>(hasSeniorityStep ? "seniority" : afterSeniority);
  const [confirming, setConfirming] = useState(false);
  const confirmedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Opening steps.
  const [seniorityText, setSeniorityText] = useState(priorProfile?.seniorityNumber ? String(priorProfile.seniorityNumber) : "");
  const [storyText, setStoryText] = useState(() => loadStoryDraft(userId, bidPack.id));
  useEffect(() => {
    const t = setTimeout(() => saveStoryDraft(userId, bidPack.id, storyText), 400);
    return () => clearTimeout(t);
  }, [userId, bidPack.id, storyText]);
  const [isCommuter, setIsCommuter] = useState<boolean | null>(priorProfile?.isCommuter ?? null);
  const [commuteDeclined, setCommuteDeclined] = useState(false);
  const [commuteFrom, setCommuteFrom] = useState(priorProfile?.commuteFrom ?? "");
  const [hasCrashPad, setHasCrashPad] = useState<boolean | null>(priorProfile?.hasCrashPad ?? null);
  /** Hours at home that make going home between trips worth it — under it, the trips around the gap are one departure. */
  const [minHomeHours, setMinHomeHours] = useState<number | null>(priorProfile?.minHomeHours ?? null);
  const [cityRatings, setCityRatings] = useState<Record<string, CityRating>>(() => ({ ...(priorProfile?.cityRatings ?? {}) }));
  const [cityPreferences, setCityPreferences] = useState<Record<string, CitySentiment>>(() => ({ ...(priorProfile?.cityPreferences ?? {}) }));
  /** Cities the story itself rated, as the brain read it — shown as such on the city step until the pilot changes them. */
  const [storySuggested, setStorySuggested] = useState<Record<string, CitySentiment>>({});
  /** Cities the pilot graded on the screen themselves, whatever the grade — the story's reading never overrides them. */
  const touchedCities = useRef(new Set<string>());
  const [homeCity, setHomeCity] = useState<string | null>(null);
  /** The home airport the commute step marked loved, when it was this step that did. */
  const autoLovedHome = useRef<string | null>(null);
  const cityFacts = useMemo(() => packCityFacts(bidPack), [bidPack]);

  // The interview itself.
  const [exchanges, setExchanges] = useState<InterviewExchange[]>(() => (checkIn && lastTime ? carryForward(lastTime.exchanges) : []));
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [choices, setChoices] = useState<LineChoice[]>([]);
  /** Their trip grades, as choices between trips — tunes how each priority counts on a single trip (`fitTripWeights`). */
  const [tripChoices, setTripChoices] = useState<TripChoice[]>([]);
  /** The trade behind every line pair already put to the pilot, so no trade is asked about more than twice. */
  const [pastTrades, setPastTrades] = useState<string[]>([]);
  const [model, setModel] = useState<PilotModel | null>(() => {
    const prior = checkIn ? (priorProfile?.brainInterview?.reviewedModel ?? priorProfile?.pilotModel ?? null) : null;
    // It read last month's whole record; what's carried is shorter once that passes the limit, so this month's answers
    // would sit below where it read up to and never be marked new. It has read all that's carried.
    return prior && lastTime && prior.readUpTo !== undefined ? { ...prior, readUpTo: Math.min(prior.readUpTo, carryForward(lastTime.exchanges).length) } : prior;
  });
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
  /** Bumped whenever answers are taken back (Back, or a rewritten story): a read already under way is then out of date. */
  const generation = useRef(0);
  /** The story the current reads started from — sending a different one starts the reading over. */
  const readStory = useRef<string | null>(null);
  const modelRef = useRef<PilotModel | null>(null);
  modelRef.current = model;
  const tradesRef = useRef<string[]>([]);
  /** The trip grades so far, kept in step with `tripChoices` for the next question, which can't wait for a render. */
  const tripRef = useRef<TripChoice[]>([]);
  tradesRef.current = pastTrades;
  // How many of the pilot's top-10 lines each re-read changed — the interviewer wraps up once answers stop moving it.
  const topRef = useRef<string[] | null>(null);
  const shiftsRef = useRef<number[]>([]);

  // The pack brief and measurements are worked out once, the first time they're needed.
  const briefRef = useRef<string | null>(null);
  const pm = useMemo(() => prepareMetrics(bidPack), [bidPack]);
  // The pack's real line and trip numbers: a question may only name these.
  const packNumbers = useMemo(() => ({ lines: bidPack.lines.map((l) => l.lineNumber), trips: [...new Set(bidPack.lines.flatMap((l) => l.trips.map((t) => t.pairingNumber ?? t.id)))] }), [bidPack]);
  const packBrief = () => (briefRef.current ??= buildPackBrief(bidPack, pm));

  // The interview only renders once the bid pack has loaded from this device, so local storage is always there to read.
  const [resume, setResume] = useState<DraftState | null>(() => (typeof window === "undefined" ? null : loadDraftState(userId, bidPack.id)));
  // A signed-in pilot's draft also lives on their account: begun on another device, or kept after this browser cleared
  // its storage. The newer of the two is the one offered.
  const olderPackId = bidPack.id === packIdFor(bidPack) ? legacyPackIdFor(bidPack) : null;
  /** The pilot picked Resume or Start fresh: a server draft arriving after that doesn't replace their choice. */
  const draftChosen = useRef(false);
  /** The account's copy gone — under the older id too, or another device would keep offering it. */
  const clearServerDrafts = () => {
    void clearServerDraft(bidPack.id);
    if (olderPackId) void clearServerDraft(olderPackId);
  };
  useEffect(() => {
    if (!userId) return;
    let live = true;
    // Saved from another device before ids named the aircraft: under the pack's older id.
    void fetchServerDraft<DraftState>(bidPack.id)
      .then((d) => d ?? (olderPackId ? fetchServerDraft<DraftState>(olderPackId) : null))
      .then((d) => {
        const server = usableDraft(d);
        // Resumed or started fresh before it came back: that choice stands — not overwritten by the account's copy.
        if (live && server && !draftChosen.current) setResume((local) => (local && local.savedAt >= server.savedAt ? local : server));
      });
    return () => {
      live = false;
    };
  }, [userId, bidPack.id, olderPackId]);

  const pilotContext = () =>
    pilotContextFor(bidPack, { isCommuter, commuteFrom, hasCrashPad, minHomeHours: isCommuter ? minHomeHours : null }) +
    (checkInRef.current ? " This is a monthly check-in: the earlier part of the interview is from last month, on a different bid pack — its line numbers don't exist in this pack; everything else they said still stands unless they say it changed." : "");

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
    const gen = generation.current;
    const promise: Promise<PilotModel | null> = requestModelBuild({ packBrief: packBrief(), pilotContext: pilotContext(), cohort: cohort(), exchanges: all, prior: modelRef.current })
      .then((m) => {
        // Read from answers the pilot has since taken back: drop it.
        if (gen !== generation.current) return null;
        if (upTo >= builtUpTo.current) {
          builtUpTo.current = upTo;
          const rated = applyCityRatings(m, finalCityRatings());
          const top = topLines(bidPack, rated, pm);
          if (topRef.current) shiftsRef.current = [...shiftsRef.current, topShift(topRef.current, top)];
          topRef.current = top;
          // Straight into the ref, not only state: whoever awaited this read asks the next question before React re-renders.
          modelRef.current = rated;
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
        if (buildRef.current?.promise === promise) buildRef.current = null;
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
    // Never a city the pilot set on the screen — set back to neutral, it isn't in their marks, and a later read would put
    // the story's grade straight back.
    for (const code of touchedCities.current) delete suggested[code];
    if (!Object.keys(suggested).length) return;
    setStorySuggested((p) => ({ ...suggested, ...p }));
    // Only cities the pilot hasn't rated themselves.
    setCityPreferences((prev) => ({ ...suggested, ...prev }));
  }

  function finalCityRatings(): Record<string, CityRating> {
    const out: Record<string, CityRating> = {};
    // Grades for cities this pack doesn't fly to stay: they're the pilot's, and the next pack may go there.
    for (const [code, r] of Object.entries(cityRatings)) if (!cityFacts.some((c) => c.code === code)) out[code] = r;
    for (const c of cityFacts) {
      const score = effectiveCityScore(c.code, cityRatings, cityPreferences);
      // A city neutral most of the year is kept when there's more to it: seasons, hotels, "I'd try it", a note. So is
      // one the story graded and the pilot set back to neutral: their 0 has to outweigh the brain's reading of the story.
      if (score !== 0 || saysMore(cityRatings[c.code]) || (touchedCities.current.has(c.code) && storySuggested[c.code])) out[c.code] = { ...cityRatings[c.code], score };
    }
    return out;
  }

  /** Forgets every read so far — the story they're sending isn't the one those reads were of. */
  function restartReading() {
    generation.current += 1;
    buildRef.current = null;
    builtUpTo.current = 0;
    modelRef.current = null;
    setModel(null);
    setThreads({});
    topRef.current = null;
    shiftsRef.current = [];
    // Cities the old story rated that the pilot left as suggested go with it.
    setCityPreferences((prev) => {
      const next = { ...prev };
      for (const [code, s] of Object.entries(storySuggested)) if (next[code] === s && !cityRatings[code]) delete next[code];
      return next;
    });
    setStorySuggested({});
  }

  function submitStory() {
    const text = storyText.trim();
    if (!text) return;
    if (readStory.current !== null && readStory.current !== text) restartReading();
    readStory.current = text;
    const first = [{ turn: 0, question: OPENING_QUESTION, answer: text }];
    setExchanges(first);
    void startBuild(first);
    setPhase("commuter");
  }

  function skipStory() {
    if (readStory.current !== null) restartReading();
    readStory.current = null;
    setExchanges([]);
    setPhase("commuter");
  }

  /** The check-in's two answers join last month's record; the city step comes next. */
  function submitCheckIn(changed: string, dates: string) {
    const start = carryForward(lastTime?.exchanges ?? []);
    setExchanges([
      ...start,
      { turn: start.length, question: `${CHECK_IN_CHANGED_Q}${bidPack.month} bid pack): has anything changed since last month?`, answer: changed || NOTHING_CHANGED },
      { turn: start.length + 1, question: `${CHECK_IN_DATES_Q} in this bid period (${periodLabel})?`, answer: dates || NO_DATES },
    ]);
    setPhase("cities");
  }

  /** What the check-in already holds, for going back to it: the pilot's own words, not the stand-ins for a blank box. */
  function checkInAnswer(prefix: string, blank: string): string {
    // Only this month's two, just past last month's record carried forward — that record ends in a check-in of its own.
    const start = carryForward(lastTime?.exchanges ?? []).length;
    const answer = exchanges.slice(start, start + 2).find((e) => e.question.startsWith(prefix))?.answer ?? "";
    return answer === blank ? "" : answer;
  }

  /** Check-in: this pack's city grades join the record, the brain re-reads everything against the new pack, then a few questions about what's new. */
  async function beginCheckInQuestions() {
    const all = [...exchanges, { turn: exchanges.length, question: `This month's pack (${bidPack.month}): how do you feel about each layover city?`, answer: describeCityRatings(finalCityRatings()) || NO_CITY_RATINGS }];
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
      { turn: base.length, question: commuterPrompt(bidPack.base), answer: isCommuter === true ? `I commute in${home ? ` from ${home}` : ""}.${hasCrashPad === false ? " No crash pad." : hasCrashPad ? " I have a crash pad." : ""}${minHomeHoursSentence(minHomeHours)}` : isCommuter === false ? "I live locally." : "(skipped)" },
      { turn: base.length + 1, question: "How do you feel about each layover city in your pack?", answer: ratingsText || NO_CITY_RATINGS },
    ];
    setExchanges(opening);
    setPhase("reading");
    setError(null);
    // With no story there's nothing to read yet; with one, wait for the read started when it was sent.
    if (!buildRef.current && !modelRef.current) await startBuild(opening);
    else if (buildRef.current) await buildRef.current.promise;
    // The story's read began before the city screen, so it carries the grades from then: the first questions (and
    // the top lines the next read is compared with) go by the ones just given.
    if (modelRef.current) {
      const rated = applyCityRatings(modelRef.current, finalCityRatings());
      modelRef.current = rated;
      setModel(rated);
      topRef.current = topLines(bidPack, rated, pm);
    }
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
    const priority = t === 0 && !checkInRef.current ? priorityOrderQuestion(m) : null;
    if (priority) {
      setQuestion({ done: false, settled: [], threadId: null, kind: "choice", prompt: priority.prompt, helpText: priority.helpText, options: priority.options, priorityIds: priority.criterionIds, transcript: priorityOrderTranscript(priority) });
      setChoiceSelection(null);
      setChoiceNote("");
      setPhase("question");
      return;
    }
    // Then, also asked the same way for everyone: anything that rules a line out, whatever else it has — a weight can't
    // say "never", and enough pay always buys a weight back (see lib/brain/dealbreakers.ts).
    if (!checkInRef.current && !askedDealbreakers(all)) {
      const q = dealbreakerQuestion(bidPack, m, pm);
      setQuestion({ done: false, settled: [], threadId: null, kind: "free-text", prompt: q.prompt, helpText: q.helpText, transcript: q.transcript });
      setPhase("question");
      return;
    }
    // Then hub turning, by name, with a real trip from their pack — asked whenever the pack has night hub turns, and
    // the crew-rest hotel when it has those long sits (lib/brain/hub-turn-question.ts).
    const hub = !checkInRef.current ? nextHubTurnQuestion(bidPack, m, pm, all) : null;
    if (hub) {
      setQuestion({ done: false, settled: [], threadId: null, kind: "choice", prompt: hub.prompt, helpText: hub.helpText, options: hub.options, examples: hub.examples, transcript: hub.transcript });
      setChoiceSelection(null);
      setChoiceNote("");
      setPhase("question");
      return;
    }
    // Then, for a commuter, the time they leave before a report and how many other flights they want — each its own
    // question (lib/brain/commute-questions.ts).
    const commute = !checkInRef.current ? nextCommuteQuestion(isCommuter, all) : null;
    if (commute) {
      setQuestion({ done: false, settled: [], threadId: null, kind: "free-text", prompt: commute.prompt, helpText: commute.helpText, transcript: commute.prompt });
      setPhase("question");
      return;
    }
    const linePairs: LinePairCandidate[] = m ? pickLinePairs(bidPack, m, pm, compared, 3, tradesRef.current) : [];
    // Real lines and trips at both ends of their main priorities, for the question to show.
    const examples = m ? pickQuestionExamples(bidPack, m, pm) : [];
    try {
      const step = await requestNextStep({ packBrief: packBrief(), pilotContext: pilotContext(), cohort: cohort(), exchanges: all, model: m, threads: th, linePairs, examples, packNumbers, turn: t, maxTurns: turnLimitRef.current, rankingShifts: shiftsRef.current });
      const settledThreads = { ...th };
      for (const id of step.settled) settledThreads[id] = { ...(settledThreads[id] ?? { timesAsked: 0 }), status: "settled" };
      if (step.done) {
        setThreads(settledThreads);
        // Before wrapping up: how would they feel about flying a screen of real trips? (lib/brain/trip-sort.ts)
        const tripScreen = !checkInRef.current && m ? nextTripScreen(all, m) : null;
        if (tripScreen) {
          const asked = tripGradesTranscript(tripScreen);
          setQuestion({ done: false, settled: [], threadId: null, kind: "choice", prompt: asked, transcript: asked, tripScreen });
          setPhase("question");
          return;
        }
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
      // Not the question they just answered: answering it again would record it twice. "Try again" asks for the next one.
      setQuestion(null);
      setPhase("question");
    }
  }

  /**
   * The next screen of trips to grade, or none: two screens, then a third only if the last one surprised the model —
   * worked out from the transcript and the grades, so going back or resuming lands on the same answer.
   */
  function nextTripScreen(all: InterviewExchange[], m: PilotModel): TripGradeScreen | null {
    const shown = askedTripScreens(all);
    const graded = tripRef.current;
    const withGrades = (cs: TripChoice[]): PilotModel => ({ ...m, tripWeights: fitTripWeights(bidPack, m, cs, pm).tripWeights });
    let foreseen: number | null = null;
    const last = shown.at(-1);
    if (last) {
      const onLast = new Set(last);
      const lastScreen = graded.filter((c) => onLast.has(c.preferred) && onLast.has(c.other));
      foreseen = shareForeseen(bidPack, withGrades(graded.filter((c) => !lastScreen.includes(c))), pm, lastScreen);
    }
    if (!wantsAnotherScreen(shown.length, foreseen)) return null;
    return pickTripScreen(bidPack, withGrades(graded), pm, shown);
  }

  async function answer(text: string, choice: LineChoice | null = null, tripGraded: TripChoice[] = []) {
    if (!question) return;
    setHistory((h) => [...h, { exchanges, threads, choices, tripChoices, pastTrades, question, turn, model: modelRef.current, builtUpTo: builtUpTo.current }]);
    if (tripGraded.length) {
      tripRef.current = [...tripRef.current, ...tripGraded];
      setTripChoices(tripRef.current);
    }
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
    const trade = question.kind === "line-pair" ? question.pair?.trade : undefined;
    if (trade) {
      tradesRef.current = [...pastTrades, trade];
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
    // Back past the "anything else?" answer, which keeps no step of its own: that screen comes round again.
    if (exchanges.slice(last.exchanges.length).some((e) => isSweepQuestion(e.question))) {
      setSweepDone(false);
      turnLimitRef.current = MAX_TURNS;
      setTurnLimit(MAX_TURNS);
    }
    setExchanges(last.exchanges);
    setThreads(last.threads);
    setChoices(last.choices);
    setTripChoices(last.tripChoices);
    tripRef.current = last.tripChoices;
    setPastTrades(last.pastTrades);
    tradesRef.current = last.pastTrades;
    setQuestion(last.question);
    setTurn(last.turn);
    // What the brain made of the answer they took back goes too, including a read still under way.
    generation.current += 1;
    buildRef.current = null;
    modelRef.current = last.model;
    setModel(last.model);
    builtUpTo.current = last.builtUpTo;
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
      const rated = withHomeFacts(applyCityRatings(built, finalCityRatings()), { hasCrashPad, minHomeHours: isCommuter ? minHomeHours : null });
      // Priorities the pilot set by hand on their priorities page still hold — shown that way in the review.
      const lineFitted = applyPins(fitWeightsToChoices(bidPack, rated, ch, pm).model, priorProfile?.brainInterview?.pins ?? {});
      // The ref, not state: the last trip screen's grades were added in this same pass.
      const fitted: PilotModel = { ...lineFitted, tripWeights: fitTripWeights(bidPack, lineFitted, tripRef.current, pm).tripWeights };
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
    // Once only: a second tap before the rankings open would save the profile again and post a second outcome.
    if (!reviewModel || !ratedModel || confirmedRef.current) return;
    confirmedRef.current = true;
    setConfirming(true);
    // The pilot's verdicts land on the model before fitting, so later choices and edits refit from what they confirmed.
    const reviewed = applyPriorityReview(ratedModel, verdicts);
    const pins = priorProfile?.brainInterview?.pins ?? {};
    const lineModel = applyPins(fitWeightsToChoices(bidPack, reviewed, choices, pm).model, pins);
    const finalModel: PilotModel = { ...lineModel, tripWeights: fitTripWeights(bidPack, lineModel, tripChoices, pm).tripWeights };
    const ratings = finalCityRatings();
    const prefs: Record<string, CitySentiment> = {};
    for (const [code, r] of Object.entries(ratings)) {
      const s = sentimentFromRating(r.score);
      if (s) prefs[code] = s;
    }
    // A clean profile: the older interview's facts, targets and weights would otherwise add their own dealbreakers and
    // notes to lines this model ranks. Only what's still the pilot's carries over.
    const profile: PreferenceProfile = {
      ...carriedOver(priorProfile),
      weights: { ...DEFAULT_WEIGHTS },
      deepRoundCompleted: false,
      tradeoffAnswers: [],
      explicitTargets: {},
      isCommuter,
      commuteFrom: parseAirportCode(commuteFrom),
      hasCrashPad,
      ...(isCommuter && minHomeHours ? { minHomeHours } : {}),
      seniorityNumber: parseSeniorityInput(seniorityText),
      cityPreferences: prefs,
      cityRatings: ratings,
      completedAt: new Date().toISOString(),
      implicitWeights: {},
      implicitConfidence: {},
      discoveredFacts: [],
      interviewTranscript: [],
      pilotModel: finalModel,
      brainInterview: { exchanges, choices, ...(tripChoices.length ? { tripChoices } : {}), reviewedModel: reviewed, packId: bidPack.id, ...(Object.keys(pins).length ? { pins } : {}) },
    };
    try {
      window.localStorage.removeItem(draftKey(userId, bidPack.id));
    } catch {}
    if (userId) void clearServerDrafts();
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

  // Progress worth resuming: saved after every answer — the moment it's sent, not once the next question arrives, so an
  // answer isn't lost to a phone locking while that question is worked out (resuming then asks it again).
  useEffect(() => {
    if ((phase !== "question" && phase !== "sweep" && phase !== "asking") || exchanges.length === 0) return;
    const d: DraftState = { version: 1, savedAt: Date.now(), phase: phase === "sweep" ? "sweep" : "question", exchanges, threads, choices, tripChoices, pastTrades, model, question: phase === "asking" ? null : question, turn, isCommuter, commuteFrom, hasCrashPad, minHomeHours, seniorityText, cityRatings, cityPreferences, sweepDone, turnLimit, checkIn };
    try {
      window.localStorage.setItem(draftKey(userId, bidPack.id), JSON.stringify(d));
    } catch {}
    if (userId) saveServerDraft(bidPack.id, d);
  }, [phase, exchanges, threads, choices, tripChoices, pastTrades, model, question, turn, isCommuter, commuteFrom, hasCrashPad, minHomeHours, seniorityText, cityRatings, cityPreferences, sweepDone, turnLimit, checkIn, userId, bidPack.id]);

  function resumeDraft(d: DraftState) {
    draftChosen.current = true;
    // A pilot who chose "Start over" on a check-in resumes the full interview, not the check-in.
    if (d.checkIn !== undefined) {
      setCheckIn(d.checkIn);
      checkInRef.current = d.checkIn;
    }
    setExchanges(d.exchanges);
    setThreads(d.threads);
    setChoices(d.choices);
    setTripChoices(d.tripChoices ?? []);
    tripRef.current = d.tripChoices ?? [];
    setPastTrades(d.pastTrades ?? []);
    tradesRef.current = d.pastTrades ?? [];
    setModel(d.model);
    modelRef.current = d.model;
    builtUpTo.current = d.model ? d.exchanges.length : 0;
    setQuestion(d.question);
    setTurn(d.turn);
    setIsCommuter(d.isCommuter);
    setCommuteFrom(d.commuteFrom);
    setHasCrashPad(d.hasCrashPad);
    setMinHomeHours(d.minHomeHours ?? null);
    setSeniorityText(d.seniorityText);
    setCityRatings(d.cityRatings);
    setCityPreferences(d.cityPreferences);
    setSweepDone(d.sweepDone);
    turnLimitRef.current = d.turnLimit ?? MAX_TURNS;
    setTurnLimit(turnLimitRef.current);
    setResume(null);
    if (d.phase === "sweep") setPhase("sweep");
    else if (d.question) setPhase("question");
    // Asked once the draft's answers have rendered: asked now, the request would carry this screen's commute and cohort, not the draft's.
    else setResumeAsk(d);
  }
  const [resumeAsk, setResumeAsk] = useState<DraftState | null>(null);
  useEffect(() => {
    if (!resumeAsk) return;
    setResumeAsk(null);
    void askNext(resumeAsk.exchanges, resumeAsk.threads, resumeAsk.choices, resumeAsk.turn, resumeAsk.sweepDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeAsk]);

  // ----- Rendering -----

  const opening = (checkIn ? ["seniority", "checkin", "cities"] : ["seniority", "story", "commuter", "cities"]) as readonly Phase[];
  const stepTotal = opening.length - (hasSeniorityStep ? 0 : 1);
  const stepIndex = Math.max(0, opening.indexOf(phase as (typeof opening)[number]) - (hasSeniorityStep ? 0 : 1));
  const eyebrow = (label: string) => `Step ${stepIndex + 1} of ${stepTotal} · ${label}`;
  const inOpening = (opening as readonly string[]).includes(phase);
  // No fixed length to measure against: the bar runs toward about how many questions this pilot's priorities call for,
  // and keeps a little room ahead while the interview is still going.
  const expectedTurns = Math.min(turnLimit, Math.max(minTurnsFor(model) + 4, turn + 3));
  const progress = inOpening ? (stepIndex / stepTotal) * 0.2 : phase === "review" ? 0.97 : phase === "building" || phase === "sweep" ? 0.9 : 0.2 + Math.min(0.65, (turn / expectedTurns) * 0.7);
  const lastAnswer = exchanges.at(-1);
  const lastExchange: LastExchange | null = lastAnswer && lastAnswer.turn > 0 && !lastAnswer.question.startsWith("How do you feel about each layover") ? { question: lastAnswer.question.replace(/ \[(Line|Trip) .*\]$/, ""), answer: lastAnswer.answer } : null;
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
      return (
        <CheckInStep
          model={model}
          periodLabel={periodLabel}
          eyebrow="Monthly check-in"
          onContinue={submitCheckIn}
          onStartOver={startOverInstead}
          initialChanged={checkInAnswer(CHECK_IN_CHANGED_Q, NOTHING_CHANGED)}
          initialDates={checkInAnswer(CHECK_IN_DATES_Q, NO_DATES)}
        />
      );
    }
    if (phase === "story") {
      return (
        <BiddingStoryStep
          value={storyText}
          onChange={setStoryText}
          onSubmit={submitStory}
          onSkip={skipStory}
          busy={false}
          error={null}
          maxLength={MAX_STORY}
          eyebrow={eyebrow("Your story")}
        />
      );
    }
    if (phase === "commuter") {
      return (
        <CommuterStep
          value={isCommuter}
          onChange={(v) => {
            setIsCommuter(v);
            setCommuteDeclined(v === null);
          }}
          declined={commuteDeclined}
          base={bidPack.base}
          eyebrow={eyebrow("Your commute")}
        >
          {isCommuter === true && (
            <div className="mt-6 rounded-xl border border-hairline bg-canvas/50 p-4">
              <label htmlFor="brain-commute-from" className="mb-1 block text-sm font-medium text-ink">
                Where do you commute from?
              </label>
              <p className="mb-2 text-xs text-ink-muted">The airport code — it lets us count your real time away from home, and the other flights you could commute on.</p>
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
              <div className="text-sm font-medium text-ink">{namedDomicile("Got a crash pad in the domicile city?", bidPack.base)}</div>
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
              <div className="mt-5">
                <MinHomeHoursPicker value={minHomeHours} onChange={setMinHomeHours} base={bidPack.base} id="brain-min-home" />
              </div>
            </div>
          )}
          <StepNav
            onNext={() => {
              const home = isCommuter ? parseAirportCode(commuteFrom) : null;
              const isHome = home && cityFacts.some((c) => c.code === home) ? home : null;
              const next = { ...cityPreferences };
              // The home this step itself marked loved, when they've since changed it (a typo fixed, or living locally
              // after all), stops being a loved layover — unless they graded it themselves.
              const marked = autoLovedHome.current;
              if (marked && marked !== isHome) {
                if (next[marked] === "love" && !cityRatings[marked]) delete next[marked];
                autoLovedHome.current = null;
              }
              if (isHome && !next[isHome]) {
                next[isHome] = "love";
                autoLovedHome.current = isHome;
              }
              setCityPreferences(next);
              setHomeCity(isHome);
              setPhase("cities");
            }}
            nextLabel="Next"
            // "Prefer not to say" is an answer too; only not having answered at all holds Next back.
            disabled={isCommuter === null && !commuteDeclined}
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
              touchedCities.current.add(code);
              setCityRatings((prev) => rateCity(code, score, prev, cityPreferences).ratings);
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
              if (implied === 0 && !saysMore(cityRatings[code])) return;
              setCityRatings((prev) => {
                const next: CityRating = { ...prev[code], score: prev[code]?.score ?? implied, note };
                if (!note) delete next.note;
                // A neutral city with its note emptied and nothing else said isn't a rating any more.
                if (next.score === 0 && !saysMore(next)) {
                  const rest = { ...prev };
                  delete rest[code];
                  return rest;
                }
                return { ...prev, [code]: next };
              });
            }}
            onSeason={(code, season, value) => setCityRatings((prev) => rateCitySeason(code, season, value, prev, cityPreferences))}
            onHotel={(code, hotel, score) => setCityRatings((prev) => rateCityHotel(code, hotel, score, prev, cityPreferences))}
            onUntried={(code, untried) => {
              touchedCities.current.add(code);
              const next = markCityUntried(code, untried, cityRatings, cityPreferences);
              setCityRatings(next.ratings);
              setCityPreferences(next.sentiments);
            }}
            carried={checkIn ? cityFacts.filter((c) => priorProfile?.cityRatings?.[c.code]).map((c) => c.code) : []}
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
    if (phase === "review" && reviewModel) return <PriorityReviewStep model={reviewModel} eyebrow="Your priorities" onConfirm={confirmReview} busy={confirming} />;
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
      if (q.tripScreen) {
        const ts = q.tripScreen;
        return (
          <div key={`${ts.keys.join("|")}-${turn}`}>
            {ack}
            <TripSortStep
              eyebrow={questionEyebrow}
              screen={ts}
              bidPack={bidPack}
              index={askedTripScreens(exchanges).length}
              onAnswer={(grades, why) => answer(tripGradesAnswer(ts, grades, why), null, choicesFromGrades(grades, why))}
              onSkip={() => void answer("(skipped)")}
            />
          </div>
        );
      }
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
            <ChoiceStep
              prompt={q.prompt}
              helpText={q.helpText}
              eyebrow={questionEyebrow}
              options={q.options.map((label) => ({ label }))}
              selected={choiceSelection}
              onSelect={setChoiceSelection}
              lead={q.examples?.length ? <QuestionExamples examples={q.examples} bidPack={bidPack} /> : null}
            >
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
            {q.examples?.length ? <QuestionExamples examples={q.examples} bidPack={bidPack} className="mb-4" /> : null}
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
    // Any question showing lines (two side by side, or examples) needs the pack's whole month across, so it gets the page's width.
    <div className={`mx-auto w-full ${phase === "question" && (question?.kind === "line-pair" || question?.examples?.some((e) => e.kind === "line")) ? "max-w-6xl" : "max-w-2xl"}`}>
      <InterviewProgress base={bidPack.base} fraction={progress} left={inOpening ? "Getting started" : phase === "review" ? "Your priorities" : `${turn} answered`} right={inOpening ? (checkIn ? "About 3–5 min" : "About 20–30 min") : phase === "review" ? "Last step" : checkIn ? "Monthly check-in" : "Story-driven"} />

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
                draftChosen.current = true;
                try {
                  window.localStorage.removeItem(draftKey(userId, bidPack.id));
                } catch {}
                if (userId) void clearServerDrafts();
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
