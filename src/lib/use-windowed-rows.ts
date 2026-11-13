"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Which rows of a long list of heavy cards to draw in full: the ones on screen, then — a few at a time while the page is
 * idle — those up to a screen either side. Every other row stands in at the height its card last had (or the height
 * the drawn cards usually have), with its line's number on it, so the page keeps its full length, the scroll bar tells
 * the truth, Find in page finds a line by its number, and a link or a key can scroll to any line before it's drawn.
 * Showing all 489 lines of the biggest pack used to keep a phone busy for most of a minute building cards nobody had
 * scrolled to, and every swap after that re-drew them all.
 *
 * Rows are the list's children marked `data-row`, in order. Where the screen is gets read off them (a binary search, a
 * handful of reads) after each render and on scroll, so nothing has to add up rows, headings and gaps by itself.
 */

/** What a stand-in takes before any card has been measured on this screen: about a closed strip on a phone. */
const FIRST_GUESS_PX = 177;
/** Cards added each idle moment beyond the screen: one is a few milliseconds to draw on a slow phone. */
const STEP = 3;
/** How many of the list's first rows are always drawn, once the page is idle. */
const LEAD = 6;

interface Range {
  /** On screen. */
  start: number;
  end: number;
  /** Within a screen of it. */
  nearStart: number;
  nearEnd: number;
}

/** Card heights by line, kept from when each was last drawn; and the commonest, for one not drawn yet. */
class Heights {
  private byId = new Map<string, number>();
  private counts = new Map<number, number>();
  usual = FIRST_GUESS_PX;
  of(id: string): number {
    return this.byId.get(id) ?? this.usual;
  }
  /** Whether it changed. */
  set(id: string, height: number): boolean {
    if (!height || this.byId.get(id) === height) return false;
    this.byId.set(id, height);
    const n = (this.counts.get(height) ?? 0) + 1;
    this.counts.set(height, n);
    if (n > (this.counts.get(this.usual) ?? 0)) this.usual = height;
    return true;
  }
}

export interface WindowedRows {
  /** Whether the row at this place in the list is drawn in full. */
  drawn: (index: number) => boolean;
  /** The height a row's stand-in takes. */
  heightOf: (id: string) => number;
  /** Put on a drawn row's card, so its stand-in later takes the same room. */
  measure: (id: string) => (el: HTMLElement | null) => void;
}

/**
 * The rows of `listRef` (one per id, in order) to draw; all of them with `all` (for printing). `shape` names how cards
 * are drawn (the strip view, the list's width): when it changes, the heights kept from before no longer hold. With
 * `hold`, what's drawn stays as it is (during a drag: cards coming and going under it move the lines it's measured
 * against, and a keyboard swap then found nothing to land on now and then).
 */
export function useWindowedRows(listRef: RefObject<HTMLElement | null>, ids: string[], first: number, all = false, shape = "", hold = false): WindowedRows {
  const [range, setRange] = useState<Range>({ start: 0, end: first, nearStart: 0, nearEnd: first });
  const holding = useRef(hold);
  useLayoutEffect(() => {
    holding.current = hold;
  }, [hold]);
  const [kept, setKept] = useState(() => ({ shape, heights: new Heights() }));
  let heights = kept.heights;
  if (kept.shape !== shape) {
    heights = new Heights();
    setKept({ shape, heights });
  }
  // The cards near the screen that are drawn: once drawn, a card stays while it's near, and one more near it is let in
  // a few at a time. A sort or a jump down the list then draws what's on screen at once and the rest after, rather
  // than every card within a screen of it in the same moment; a swap keeps every card it had.
  const [near] = useState(() => new Set<string>());
  const [, letMoreIn] = useState(0);

  const locate = useCallback(() => {
    const list = listRef.current;
    if (!list || holding.current) return;
    const rows = list.querySelectorAll<HTMLElement>(":scope > [data-row]");
    const n = rows.length;
    if (!n) return;
    const screen = window.innerHeight;
    // The first row whose bottom is below `y` on screen.
    const firstEndingBelow = (y: number) => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].getBoundingClientRect().bottom < y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const start = Math.min(firstEndingBelow(0), n - 1);
    const end = Math.max(start + 1, Math.min(n, firstEndingBelow(screen) + 1));
    const nearStart = Math.min(start, firstEndingBelow(-screen));
    // The list's first few count as near wherever the page is: on a phone the list starts more than a screen down, and
    // its top lines are the ones a pilot scrolls to first (and a key or a drag reaches for).
    const nearEnd = Math.max(end, Math.min(n, Math.max(LEAD, firstEndingBelow(2 * screen) + 1)));
    setRange((r) => (r.start === start && r.end === end && r.nearStart === nearStart && r.nearEnd === nearEnd ? r : { start, end, nearStart, nearEnd }));
  }, [listRef]);

  // After every render: rows came, went, opened or changed height, and what's on screen may have changed with them.
  // Read before the browser paints, so a sort or a cleared filter shows its cards rather than their stand-ins.
  useLayoutEffect(locate);

  useEffect(() => {
    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        locate();
      });
    };
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
      cancelAnimationFrame(frame);
    };
  }, [locate]);

  // With the line just past each edge: a swap from the keyboard goes onto the line above or below, which has to be
  // drawn to be dropped on, even when it's only just off the screen.
  const onScreen = (i: number) => i >= range.start - 1 && i <= range.end;
  const drawn = (i: number) => all || onScreen(i) || (i >= range.nearStart && i < range.nearEnd && near.has(ids[i]));

  // What's drawn now is what stays drawn; then, in idle time, the next few nearest the screen.
  useEffect(() => {
    if (hold) return;
    const now = new Set<string>();
    for (let i = range.nearStart; i < Math.min(range.nearEnd, ids.length); i++) if (onScreen(i) || near.has(ids[i])) now.add(ids[i]);
    near.clear();
    for (const id of now) near.add(id);
    const waiting: number[] = [];
    for (let i = range.nearStart; i < Math.min(range.nearEnd, ids.length); i++) if (!now.has(ids[i])) waiting.push(i);
    if (!waiting.length || all) return;
    const mid = (range.start + range.end) / 2;
    waiting.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const more = () => {
      for (const i of waiting.slice(0, STEP)) near.add(ids[i]);
      letMoreIn((x) => x + 1);
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(more, { timeout: 300 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(more, 32);
    return () => window.clearTimeout(id);
  });

  // One observer for every drawn card: its height is kept for its stand-in.
  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Map<Element, string>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  useEffect(() => {
    const seen = observed.current;
    const watch = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = seen.get(entry.target);
        if (id && heights.set(id, Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height))) changed = true;
      }
      if (changed) locate();
    });
    observer.current = watch;
    for (const el of seen.keys()) watch.observe(el);
    return () => watch.disconnect();
  }, [heights, locate]);

  const measure = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      let current: HTMLElement | null = null;
      ref = (el: HTMLElement | null) => {
        if (current) {
          observer.current?.unobserve(current);
          observed.current.delete(current);
        }
        current = el;
        if (el) {
          observed.current.set(el, id);
          observer.current?.observe(el);
        }
      };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);

  return { drawn, heightOf: (id: string) => heights.of(id), measure };
}
