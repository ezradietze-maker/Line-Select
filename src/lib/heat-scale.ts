/**
 * The Heat Map's colours: a thermal camera's scale, cold to hot — near-black, blue, purple, red, orange, yellow, white
 * hot — so the hotter a piece of a trip, the better it is for the pilot. Seven stops, `--heat-0` … `--heat-6`, set for
 * each mode in globals.css (red light only at night: dim to bright red), and mixed between in the browser.
 */

export const HEAT_STOPS = 7;

/** The scale's colour at `heat` (0 cold … 1 hot), as a CSS colour. */
export function heatColor(heat: number): string {
  const at = Math.min(1, Math.max(0, Number.isFinite(heat) ? heat : 0.5)) * (HEAT_STOPS - 1);
  const i = Math.min(HEAT_STOPS - 2, Math.floor(at));
  const into = Math.round((at - i) * 100);
  if (into <= 0) return `var(--heat-${i})`;
  if (into >= 100) return `var(--heat-${i + 1})`;
  return `color-mix(in oklab, var(--heat-${i + 1}) ${into}%, var(--heat-${i}))`;
}

/** A see-through wash of the scale's colour at `heat`: a duty period's band, behind its flights drawn in the full colour. */
export function heatWash(heat: number): string {
  return `color-mix(in oklab, ${heatColor(heat)} 32%, transparent)`;
}

/** The fine edge round a flight drawn in heat, so a pale yellow reads on a light card and a near-black on a dark one. */
export const HEAT_EDGE = "0 0 0 1px color-mix(in oklab, var(--color-ink) 50%, transparent)";

/** The whole scale, cold to hot, as a CSS gradient — for its key. */
export const HEAT_GRADIENT = `linear-gradient(to right, ${Array.from({ length: HEAT_STOPS }, (_, i) => `var(--heat-${i})`).join(", ")})`;
