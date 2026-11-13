import type { InterviewExchange } from "@/lib/brain/build-model";

/**
 * How long one answer in the interview can be. The brain routes refuse an interview with a longer one
 * (`lib/server/brain-input.ts`), so every box an answer is typed or dictated into stops here — about 15 minutes of
 * talking, far past any real answer.
 */
export const MAX_ANSWER = 12_000;

/**
 * A "why" under a pick. The answer sent is the pick in words ("I'd bid line 2041 over line 2007 (easily).", a choice's
 * own label, a screen of trip grades) and then this, so it leaves them room.
 */
export const MAX_NOTE = MAX_ANSWER - 1_000;

/** Below this many characters left, a box says how many are left. */
export const SHOW_LEFT_UNDER = 500;

/**
 * Every answer cut to the limit. A box can't take a longer one, but a draft saved before the boxes stopped there could
 * hold one, and the routes then refused every call after it, however often the pilot tried again.
 */
export function fitExchanges(exchanges: InterviewExchange[]): InterviewExchange[] {
  return exchanges.some((e) => e.answer.length > MAX_ANSWER) ? exchanges.map((e) => (e.answer.length > MAX_ANSWER ? { ...e, answer: e.answer.slice(0, MAX_ANSWER) } : e)) : exchanges;
}
