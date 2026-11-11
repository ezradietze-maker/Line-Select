/**
 * A question for a commuter, asked the same way every time and without a model call: how much time they leave before a
 * report. The brain reads the answer into the pilot's commute settings (`home.commuteBufferHours`). How many other
 * flights they'd want was asked too until the owner called it unnecessary (Nov 2026); trips short on other flights are
 * still measured, against two unless the pilot gives a number of their own.
 */

export const COMMUTE_TIME_QUESTION = "When commuting in, how much time would you like to leave before your report?";
/** No longer asked; kept so a saved interview that asked it still reads as a fixed question. */
export const OTHER_FLIGHTS_QUESTION = "If your planned flight fills up, how many other flights would you want that still get you there in time?";

export interface CommuteQuestion {
  prompt: string;
  helpText: string;
}

const QUESTIONS: CommuteQuestion[] = [
  { prompt: COMMUTE_TIME_QUESTION, helpText: "Say it however you think of it, like \"I like to land 3 hours before\" or \"I go in the night before\"." },
];

/** The next one to ask a commuter, or none once it's asked (or for a pilot who doesn't commute). */
export function nextCommuteQuestion(isCommuter: boolean | null, exchanges: { question: string }[]): CommuteQuestion | null {
  if (isCommuter !== true) return null;
  return QUESTIONS.find((q) => !exchanges.some((e) => e.question === q.prompt)) ?? null;
}
