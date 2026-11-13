/**
 * Tab inside a dialog, worked out by hand: the browser's own Tab leaves a dialog for the page behind it, and Safari's
 * skips buttons altogether (unless "Press Tab to highlight each item" is on), so after a few presses it was out.
 */

/** What a stop needs saying about it: radios share one stop per group, as the browser gives them. */
export interface StopInfo {
  radioGroup?: string | null;
  checked?: boolean;
}

/** The stops Tab visits: everything given, but one per radio group — its checked radio, or its first when none is. */
export function tabStops<T>(candidates: T[], info: (el: T) => StopInfo): T[] {
  const groups = new Map<string, T>();
  for (const el of candidates) {
    const { radioGroup, checked } = info(el);
    if (!radioGroup) continue;
    if (!groups.has(radioGroup) || checked) groups.set(radioGroup, el);
  }
  return candidates.filter((el) => {
    const { radioGroup } = info(el);
    return !radioGroup || groups.get(radioGroup) === el;
  });
}

/** Where Tab (or Shift+Tab) goes from `current`: round the stops, never out. From outside them, to the first (or last). */
export function nextStop<T>(stops: T[], current: T | null, backwards: boolean): T | null {
  if (stops.length === 0) return null;
  const at = current === null ? -1 : stops.indexOf(current);
  if (at === -1) return backwards ? stops[stops.length - 1] : stops[0];
  return stops[(at + (backwards ? -1 : 1) + stops.length) % stops.length];
}

/** What Tab can reach in a dialog, before the hidden and disabled are taken out. */
export const FOCUSABLE =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable="true"], [tabindex]';
