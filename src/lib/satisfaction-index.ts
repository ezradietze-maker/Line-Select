/**
 * The Satisfaction Index a pilot reads on each line: the ranking's fit score, spread over 1–100 for this pack.
 *
 * The fit score is absolute (100 is a line with no shortfall on anything the pilot asked for, `scoring-v2/score.ts`),
 * so even a pack's best line usually reads 68–90 and most lines sit in a band of 30 points or so: true, but it tells a
 * pilot little. The index keeps the order and the gaps' proportions, and only changes the scale:
 *  - the best line reads in the high 90s (96, up to 99 for a best line that really fits: a fit of 90 or more);
 *  - the rest fall away from it in proportion to how far short they are, stretched so a line near the bottom of the
 *    pack (the tenth from the bottom, `LOW_SHARE`) reads about 20, never stretched more than three times;
 *  - below that, the last few lines run down towards 1, still apart.
 * One decimal, so lines a whole number apart on the fit score aren't shown as a tie. The ranking, the order a pilot bids
 * and everything learned from a drag use the fit score; only what's shown is the index.
 */

const TOP_FLOOR = 96;
const TOP_CEILING = 99;
/** Fit scores between these set how high in the 90s the best line reads. */
const FIT_FOR_FLOOR = 50;
const FIT_FOR_CEILING = 90;
/** The line this share of the way up from the bottom reads `LOW_INDEX`. */
const LOW_SHARE = 0.1;
const LOW_INDEX = 20;
/** A pack's fit scores are never stretched more than this, so lines a hair apart don't read far apart; nor squeezed. */
const MAX_STRETCH = 3;

const tenth = (n: number) => Math.round(n * 10) / 10;

/** The scale for a pack: fit score → Satisfaction Index, from every line's fit score. */
export function satisfactionScale(fits: number[]): (fit: number) => number {
  const sorted = fits.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return (fit) => tenth(Math.min(100, Math.max(1, fit)));
  const best = sorted[sorted.length - 1];
  const low = sorted[Math.floor(LOW_SHARE * (sorted.length - 1))];
  const top = TOP_FLOOR + (TOP_CEILING - TOP_FLOOR) * Math.min(1, Math.max(0, (best - FIT_FOR_FLOOR) / (FIT_FOR_CEILING - FIT_FOR_FLOOR)));
  const stretch = best - low > 0 ? Math.min(MAX_STRETCH, Math.max(1, (top - LOW_INDEX) / (best - low))) : 1;
  const atLow = top - (best - low) * stretch;
  return (fit) => {
    if (fit >= low) return tenth(Math.max(1, top - (best - fit) * stretch));
    // The last few lines: from where the low line reads down to 1, in proportion, so they stay apart.
    return tenth(Math.max(1, 1 + (Math.max(1, atLow) - 1) * (low > 0 ? Math.max(0, fit) / low : 0)));
  };
}

/** A ranked list with its scores as the Satisfaction Index, each line's fit score kept beside it. */
export function withSatisfactionIndex<T extends { score: number }>(ranked: T[]): (T & { fitScore: number })[] {
  const scale = satisfactionScale(ranked.map((r) => r.score));
  return ranked.map((r) => ({ ...r, fitScore: r.score, score: scale(r.score) }));
}

/** "97.4": the index as every screen shows it. */
export function formatIndex(score: number): string {
  return tenth(score).toFixed(1);
}
