/**
 * Two questions for a commuter, asked the same way every time and without a model call, each on its own: how much time
 * they leave before a report, and how many other flights they want that would still get them there. One thing per
 * question — the AI used to fold both into one, with a deadhead from home on top. The brain reads the answers into the
 * pilot's commute settings (`home.commuteBufferHours`, `home.backupFlights`).
 */

export const COMMUTE_TIME_QUESTION = "When commuting in, how much time would you like to leave before your report?";
export const OTHER_FLIGHTS_QUESTION = "If your planned flight fills up, how many other flights would you want that still get you there in time?";

export interface CommuteQuestion {
  prompt: string;
  helpText: string;
}

const QUESTIONS: CommuteQuestion[] = [
  { prompt: COMMUTE_TIME_QUESTION, helpText: "Say it however you think of it, like \"I like to land 3 hours before\" or \"I go in the night before\"." },
  { prompt: OTHER_FLIGHTS_QUESTION, helpText: "Just a number is fine." },
];

/** The next one to ask a commuter, or none once both are asked (or for a pilot who doesn't commute). */
export function nextCommuteQuestion(isCommuter: boolean | null, exchanges: { question: string }[]): CommuteQuestion | null {
  if (isCommuter !== true) return null;
  return QUESTIONS.find((q) => !exchanges.some((e) => e.question === q.prompt)) ?? null;
}
