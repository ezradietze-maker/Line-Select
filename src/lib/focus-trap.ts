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

/**
 * Where focus goes when a dialog closes: back to what opened it, or when that's gone (a menu that closed, a Connect
 * button that turned into Disconnect), the first control in the nearest box around it that still has one. Only the
 * nearest box still there was asked: when it had nothing to focus (the row the button sat in), focus went to the page.
 */
export function focusBackTo<T>(opener: T | null, ancestors: T[], isConnected: (el: T) => boolean, stopsOf: (el: T) => T[]): T | null {
  if (opener && isConnected(opener)) return opener;
  for (const a of ancestors) {
    if (!isConnected(a)) continue;
    const first = stopsOf(a)[0];
    if (first) return first;
  }
  return null;
}

/**
 * Where focus goes after the page changed under the control that had it and left the keyboard on the page: back to that
 * control while it's there (a button greyed out while it works, then back), else the first control in the nearest box
 * around it still there (an editor that closed, an offer withdrawn). Nowhere yet while it's greyed out: it comes back.
 */
export function focusAfterChange<T>(held: { el: T; ancestors: T[] }, isConnected: (el: T) => boolean, isDisabled: (el: T) => boolean, stopsOf: (el: T) => T[]): T | null {
  if (isConnected(held.el) && isDisabled(held.el)) return null;
  return focusBackTo(held.el, held.ancestors, isConnected, stopsOf);
}

/** What Tab can reach in a dialog, before the hidden and disabled are taken out. */
export const FOCUSABLE =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable="true"], [tabindex]';

/**
 * The one now in `gone`'s place in a list: the first after it that's still listed, else the nearest before it. For
 * focus to go to when what held it left the list (a line hidden or set aside, a chip brought back).
 */
export function inPlaceOf<T>(before: T[], now: T[], gone: T): T | null {
  const at = before.indexOf(gone);
  if (at < 0) return null;
  const still = new Set(now);
  for (const id of before.slice(at + 1)) if (still.has(id)) return id;
  for (const id of before.slice(0, at).reverse()) if (still.has(id)) return id;
  return null;
}

/**
 * Where the keyboard goes on the ranked list: a line (its strip), a set-aside chip, the tiers' Undo, or the first control
 * in the nearest box still there around the one that went (`focusBackTo`).
 */
export type FocusHome = { line: string } | { chip: string } | { undo: true } | { near: true } | null;

/**
 * Where the keyboard goes on the ranked list when the control it was on went away: a line's own Hide or Set aside, the
 * bar for a selection (gone once the move is made), the Undo beside a swap, a set-aside chip brought back. Left alone,
 * focus fell to the page and the next Tab started again at the top.
 *
 * A chip: the next chip, else Undo. In a line, or in what works on lines (`forLines`: the selection's bar, a swap's Undo):
 * that line (or the line last worked on) while it's still listed, else the line now in its place, else Undo. Anywhere
 * else (the filters' "Clear filters"): the nearest box around it. Sent to the line last worked on, the keyboard landed
 * on a card off the screen, and the Space a pilot scrolled with opened it.
 */
export function focusHomeAfterLoss(
  lost: { lineId: string | null; chipId: string | null; forLines?: boolean },
  { listedBefore, listedNow, lastLineId, chipsBefore, chipsNow }: { listedBefore: string[]; listedNow: string[]; lastLineId: string | null; chipsBefore: string[]; chipsNow: string[] }
): FocusHome {
  if (lost.chipId) {
    const chip = inPlaceOf(chipsBefore, chipsNow, lost.chipId);
    return chip ? { chip } : { undo: true };
  }
  if (!lost.lineId && !lost.forLines) return { near: true };
  const lineId = lost.lineId ?? lastLineId;
  if (!lineId) return null;
  if (listedNow.includes(lineId)) return { line: lineId };
  const line = inPlaceOf(listedBefore, listedNow, lineId);
  return line ? { line } : { undo: true };
}
