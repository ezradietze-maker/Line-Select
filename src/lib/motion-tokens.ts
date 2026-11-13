/**
 * The JS side of globals.css's motion tokens — `motion` needs numbers and
 * arrays, not CSS custom properties, so these are kept in sync by hand.
 * Seconds, not milliseconds, since that's what `motion` takes.
 */
export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.4,
  page: 0.32,
  /** An instrument revealing itself — a value appearing, a route drawing in. */
  reveal: 0.6,
  /** A gauge needle or arc sweeping up to its reading. */
  sweep: 1.1,
  /** The five motions (globals.css --motion-*): an item racking into its slot, and the step between two in a list. */
  rack: 0.28,
  rackStep: 0.04,
  /** A picture drawing along its path. */
  draw: 0.7,
  /** A change marked in. */
  mark: 0.32,
  /** Detail opening out of what was tapped (a line's card under its strip, the next question). */
  handoff: 0.3,
} as const;

export const EASE = {
  standard: [0.4, 0, 0.2, 1] as [number, number, number, number],
  emphasized: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** Decisive, no overshoot: a strip pushed into its holder (globals.css --ease-rack). */
  rack: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
};

/** Racked lists stop staggering after this many items, so a long list is all in place within half a second. */
export const RACK_MAX_DELAY = 0.4;
