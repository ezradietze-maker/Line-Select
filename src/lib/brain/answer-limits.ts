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

/** How many answers one read can take (the brain routes refuse more — `lib/server/brain-input.ts`). */
export const MAX_EXCHANGES = 80;

/** Below this many characters left, a box says how many are left. */
export const SHOW_LEFT_UNDER = 500;

/**
 * Every answer cut to the limit. A box can't take a longer one, but a draft saved before the boxes stopped there could
 * hold one, and the routes then refused every call after it, however often the pilot tried again.
 */
export function fitExchanges(exchanges: InterviewExchange[]): InterviewExchange[] {
  return exchanges.some((e) => e.answer.length > MAX_ANSWER) ? exchanges.map((e) => (e.answer.length > MAX_ANSWER ? { ...e, answer: e.answer.slice(0, MAX_ANSWER) } : e)) : exchanges;
}

/** What the priorities page writes into the interview's record (see `PilotPrioritiesEditor`): an edit, not an interview answer. */
const fromPrioritiesPage = (e: InterviewExchange) => e.question.startsWith("Your priorities:") || e.question.startsWith("Something to add about how you bid");

/**
 * The record within the number of answers one read can take. Every level tapped on the priorities page is written into
 * it, so after a long interview "Add it" there was refused every time, with a note to go back a few answers that the
 * page can't do. The oldest of those edits go first (the newest is the pilot's word, and the model they shaped is sent
 * with the read); then, past that, the oldest answers after the story.
 */
export function fitExchangeCount(exchanges: InterviewExchange[]): InterviewExchange[] {
  if (exchanges.length <= MAX_EXCHANGES) return exchanges;
  let over = exchanges.length - MAX_EXCHANGES;
  const kept: InterviewExchange[] = [];
  for (const [i, e] of exchanges.entries()) {
    if (over > 0 && i < exchanges.length - 1 && fromPrioritiesPage(e)) over--;
    else kept.push(e);
  }
  return kept.length <= MAX_EXCHANGES ? kept : [kept[0], ...kept.slice(kept.length - MAX_EXCHANGES + 1)];
}
