import { applicableExplicitWeightIds, MIN_TURNS_BEFORE_WRAP } from "@/lib/interview-engine";

/** Rough real-world pace: the AI's turn plus reading and answering — measured at a few seconds each way. Used only to turn "questions left" into a friendly "about N min". */
const SECONDS_PER_QUESTION = 22;

export interface InterviewProgress {
  /** 0-1, never 1 until the interview is actually over. */
  fraction: number;
  /** How many of the scored dimensions have been touched so far. */
  topicsCovered: number;
  topicsTotal: number;
  /** Best guess at questions still to come. */
  questionsLeft: number;
  minutesLeft: number;
}

/**
 * Progress a pilot can trust. The interview can't end before its
 * story-adjusted minimum (`minTurnsBeforeWrap`), every dimension is covered,
 * and the essential conversations have happened — so the real remaining work
 * is whichever is larger: the questions left to reach the minimum, or one
 * question per still-uncovered dimension plus one per open essential.
 */
export function computeInterviewProgress(params: {
  turnsUsed: number;
  uncoveredCount: number;
  /** Steps before the question loop (commuter, cities, optional returning-check) that count as progress too. */
  preStepsDone: number;
  preStepTotal: number;
  /** False when the pilot's bid pack has no hotel standby, which drops that topic from the count. Defaults to true. */
  hasStandby?: boolean;
  /** The story-adjusted floor (`minTurnsBeforeWrap`); defaults to the no-story floor. */
  minTurns?: number;
  /** Essential conversations still to have (`openEssentials`), each roughly one question. */
  openEssentialsCount?: number;
}): InterviewProgress {
  const { turnsUsed, uncoveredCount, preStepsDone, preStepTotal, hasStandby = true, minTurns = MIN_TURNS_BEFORE_WRAP, openEssentialsCount = 0 } = params;
  const topicsTotal = applicableExplicitWeightIds(hasStandby).length;
  const questionsLeft = Math.max(minTurns - turnsUsed, uncoveredCount + openEssentialsCount, 1);
  const done = preStepsDone + turnsUsed;
  const total = preStepTotal + turnsUsed + questionsLeft;
  return {
    fraction: Math.min(0.97, done / total),
    topicsCovered: topicsTotal - uncoveredCount,
    topicsTotal,
    questionsLeft,
    minutesLeft: Math.max(1, Math.round((questionsLeft * SECONDS_PER_QUESTION) / 60)),
  };
}
