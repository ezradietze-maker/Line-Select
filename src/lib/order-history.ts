/**
 * One undo history for the pilot's order, newest first, across both ways of changing it: a tier change (the tiers keep
 * their own states, `lib/line-tiers.ts`, so a step here only says "the tiers' turn") and a swap. With two histories,
 * ⌘Z after a swap took back an older tier move and left the swap standing.
 */

export type OrderStep<S> = { kind: "tier" } | { kind: "swap"; swap: S };

export interface OrderHistory<S> {
  past: OrderStep<S>[];
  future: OrderStep<S>[];
}

export const EMPTY_ORDER_HISTORY: OrderHistory<never> = { past: [], future: [] };
const LIMIT = 100;

/** A new step: the newest to undo, and anything that was there to redo is gone, as in any editor. */
export function recordStep<S>(h: OrderHistory<S>, step: OrderStep<S>): OrderHistory<S> {
  return { past: [...h.past, step].slice(-LIMIT), future: [] };
}

/**
 * The step to take back, and the history after it. `keep` is what redo will need to put it back: a swap carries what
 * the brain learned from it out, so a redo can teach it again.
 */
export function takeUndo<S>(h: OrderHistory<S>, keep: (step: OrderStep<S>) => OrderStep<S> = (s) => s): { step: OrderStep<S>; history: OrderHistory<S> } | null {
  const step = h.past[h.past.length - 1];
  if (!step) return null;
  return { step, history: { past: h.past.slice(0, -1), future: [keep(step), ...h.future] } };
}

export function takeRedo<S>(h: OrderHistory<S>): { step: OrderStep<S>; history: OrderHistory<S> } | null {
  const step = h.future[0];
  if (!step) return null;
  return { step, history: { past: [...h.past, step], future: h.future.slice(1) } };
}

/** Swaps taken back some other way ("Undo" on one swap, or back to Line Select's order) leave the history altogether. */
export function dropSwaps<S>(h: OrderHistory<S>, gone: (swap: S) => boolean): OrderHistory<S> {
  const keep = (s: OrderStep<S>) => s.kind !== "swap" || !gone(s.swap);
  return { past: h.past.filter(keep), future: h.future.filter(keep) };
}
