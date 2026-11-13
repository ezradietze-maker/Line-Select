"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lists the pilot keeps on this device per pack — stars, swaps, tiers — are written by every tab that has the pack
 * open. Each tab used to write its whole list from memory, so a tab that hadn't seen another's swap or star wrote over
 * it. Now a change is merged into what's stored at the moment it's written: the other tab's changes to other lines
 * stay, and on a line both touched, the latest write wins. And a change written in another tab shows here as it lands.
 */

/**
 * Three-way: `base` is what this tab last read from or wrote to storage, `mine` is this tab's list now, `theirs` is
 * what's stored now. What changed from `base` to `mine` goes onto `theirs`.
 */
export type Merge<T> = (base: T, mine: T, theirs: T) => T;

export interface StoredList<T> {
  /** What's stored, or null when nothing readable is (then there's nothing from another tab to keep). */
  read: () => T | null;
  /** Whether the browser kept it. */
  write: (value: T) => boolean;
  merge: Merge<T>;
}

/**
 * Writes `mine` merged into what's stored, and gives back the merged list. `synced` is what this tab last read or wrote
 * (moved on only when the browser keeps the write, so a change it refused is still this tab's own next time).
 */
export function writeMerged<T>(store: StoredList<T>, synced: { current: T }, mine: T): T {
  const theirs = store.read() ?? synced.current;
  const merged = store.merge(synced.current, mine, theirs);
  if (store.write(merged)) synced.current = merged;
  return merged;
}

/** Calls `onChange` when another tab writes `key` (or clears this site's storage). */
export function useOtherTabWrites(key: string, onChange: () => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === key) latest.current();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
}

/** Whether two stored lists say the same — their JSON — so a write from another tab that changes nothing here re-renders nothing. */
export function sameStored<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A list kept under `key` and shared with the pack's other tabs (see above): `update` merges each change into what's
 * stored, and another tab's writes are merged in as they land. `current` reads the newest list from a callback that
 * runs before the last change has rendered. A new `key` (another pack, or the account found after the guest's data
 * showed) starts from what's stored under it.
 */
export function useSharedList<T>(key: string, store: StoredList<T>, empty: T) {
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  });
  const [held, setHeld] = useState(() => {
    const value = store.read() ?? empty;
    return { key, value, synced: { current: value } };
  });
  let shown = held;
  if (held.key !== key) {
    const value = store.read() ?? empty;
    shown = { key, value, synced: { current: value } };
    setHeld(shown);
  }
  // The newest list and what it was last in step with, for a change made twice before a render.
  const live = useRef(shown);
  useEffect(() => {
    if (live.current.key !== shown.key) live.current = shown;
  }, [shown]);

  const update = useCallback((change: (value: T) => T): T => {
    const now = live.current;
    const merged = writeMerged(storeRef.current, now.synced, change(now.value));
    live.current = { ...now, value: merged };
    setHeld(live.current);
    return merged;
  }, []);

  useOtherTabWrites(key, () => {
    const now = live.current;
    const fresh = storeRef.current.read();
    if (!fresh || now.key !== key) return;
    const merged = storeRef.current.merge(now.synced.current, now.value, fresh);
    now.synced.current = fresh;
    if (sameStored(merged, now.value)) return;
    live.current = { ...now, value: merged };
    setHeld(live.current);
  });

  const current = useCallback(() => live.current.value, []);
  return { value: shown.value, update, current };
}

/** Three-way merge of a list of line ids (stars, hidden lines, lines set aside): `touched` lines take `mine`'s say. */
export function mergeIds(mine: string[], theirs: string[], touched: Set<string>): string[] {
  const out = theirs.filter((id) => !touched.has(id) || mine.includes(id));
  for (const id of mine) if (touched.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/** The ids whose membership differs between two lists. */
export function changedIds(a: string[], b: string[]): string[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...a.filter((id) => !sb.has(id)), ...b.filter((id) => !sa.has(id))];
}
