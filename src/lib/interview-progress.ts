import { EXPLICIT_WEIGHT_IDS, MIN_TURNS_BEFORE_WRAP } from "@/lib/interview-engine";

/** Rough real-world pace: the AI's turn plus reading and answering — measured at a few seconds each way. Used only to turn "questions left" into a friendly "about N min". */
const SECONDS_PER_QUESTION = 22;

export interface InterviewProgress {
  /** 0-1, never 1 until the interview is actually over. */
  fraction: number;
  /** How many of the 15 scored dimensions have been touched so far. */
  topicsCovered: number;
  topicsTotal: number;
  /** Best guess at questions still to come. */
  questionsLeft: number;
  minutesLeft: number;
}

/**
 * Progress a pilot can trust. The old "question 2 of roughly 35" counted
 * against the soft cap even though the interview can't end before
 * MIN_TURNS_BEFORE_WRAP questions AND every dimension is covered — so it
 * overstated the length at the start and understated nothing. The real
 * remaining work is whichever is larger: the questions left to reach the
 * minimum, or one more question per still-uncovered topic.
 */
export function computeInterviewProgress(params: {
  turnsUsed: number;
  uncoveredCount: number;
  /** Steps before the question loop (commuter, cities, optional returning-check) that count as progress too. */
  preStepsDone: number;
  preStepTotal: number;
}): InterviewProgress {
  const { turnsUsed, uncoveredCount, preStepsDone, preStepTotal } = params;
  const topicsTotal = EXPLICIT_WEIGHT_IDS.length;
  const questionsLeft = Math.max(MIN_TURNS_BEFORE_WRAP - turnsUsed, uncoveredCount, 1);
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
