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
} as const;

export const EASE = {
  standard: [0.4, 0, 0.2, 1] as [number, number, number, number],
  emphasized: [0.16, 1, 0.3, 1] as [number, number, number, number],
};
