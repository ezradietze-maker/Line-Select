"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTier,
  applyTiers,
  bringBack,
  clearTiers,
  EMPTY_HISTORY,
  hasTiers,
  lessonChanges,
  lessonsFromMove,
  linesThatWouldMove,
  loadTiers,
  mergeTiers,
  moveToTier,
  notBidIds,
  pruneTiers,
  pushHistory,
  readTiers,
  redoTiers,
  removeTier,
  renameTier,
  saveTiers,
  setAsideLines,
  swapTiers,
  tiersKey,
  undoTiers,
  type TierHistory,
  type TierState,
} from "@/lib/line-tiers";
import type { LineScore } from "@/lib/scoring";
import { sameStored, useOtherTabWrites } from "@/lib/shared-store";
import type { LineChoice } from "@/types/pilot-model";

/**
 * Hands what a tier move taught to the brain: choices to add and moves whose choices no longer count. Gives back the
 * choices each retracted move had, as the brain held them, so an undo can put them back: after a reload, the moves the
 * saved tiers name were taught in an earlier visit, and this hook never saw their choices.
 */
export type TeachTiers = (add: LineChoice[], retract: string[]) => Record<string, LineChoice[]> | void;

export interface LineTiers {
  state: TierState;
  inUse: boolean;
  /** Lines in tier order. */
  order: (list: LineScore[]) => LineScore[];
  notBid: Set<string>;
  setAside: Set<string>;
  tierOf: (lineId: string) => string | undefined;
  selected: Set<string>;
  toggleSelected: (lineId: string, rangeOver?: string[]) => void;
  clearSelected: () => void;
  move: (lineIds: string[], tierId: string | null) => void;
  park: (lineIds: string[]) => void;
  unpark: (lineIds: string[]) => void;
  /** Two lines trade tiers: a drag from one onto a line in another. */
  swap: (a: string, b: string) => void;
  rename: (tierId: string, name: string) => void;
  add: (name: string) => void;
  remove: (tierId: string) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What the last move did, for a screen reader and the pilot alike. */
  said: string;
  /**
   * Says something else in the same place: the list's other keys (s shortlists a line) speak where the tier moves do,
   * so the page has one voice and two never talk over each other.
   */
  say: (message: string) => void;
}

let moveCounter = 0;
const newMoveId = () => `tier-${Date.now().toString(36)}-${(moveCounter++).toString(36)}`;

/**
 * The pilot's tiers for this pack, with undo and redo, and what each move teaches the brain. Lessons are kept beside the
 * history for a redo to give back; after a reload the state is what's kept, and undoing starts from there.
 */
export function useLineTiers(
  userId: string | null,
  bidPackId: string,
  lineIds: string[],
  rankedList: LineScore[],
  teach: { current: TeachTiers | null },
  /** Told of every change the pilot can undo (not undo and redo themselves): the page keeps one history across tiers and swaps. */
  onRecord?: () => void
): LineTiers {
  const owner = `${userId}|${bidPackId}`;
  const valid = useMemo(() => new Set(lineIds), [lineIds]);
  // `synced`: the tiers as this tab last read or wrote them, which another tab's writes are merged against (see
  // `lib/shared-store.ts`).
  const [loaded, setLoaded] = useState(() => {
    const kept = pruneTiers(loadTiers(userId, bidPackId), valid);
    return { owner, state: kept, history: EMPTY_HISTORY as TierHistory, synced: kept };
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const lessons = useRef(new Map<string, LineChoice[]>());
  if (loaded.owner !== owner) {
    const kept = pruneTiers(loadTiers(userId, bidPackId), valid);
    setLoaded({ owner, state: kept, history: EMPTY_HISTORY, synced: kept });
    setSelected(new Set());
    setAnchor(null);
    setSaid("");
  }
  const { state, history, synced } = loaded;

  // The newest of everything, for a move made from a keyboard handler or a callback that was set up a render ago.
  const latest = useRef({ state, history, rankedList, synced });
  useEffect(() => {
    latest.current = { state, history, rankedList, synced };
  }, [state, history, rankedList, synced]);

  // Another tab moved lines on this pack: its moves show here, and this tab's undo history gets them too, so undoing
  // here takes back only what was done here.
  useOtherTabWrites(tiersKey(userId, bidPackId), () => {
    const stored = readTiers(userId, bidPackId);
    const { state: s, history: h, synced: base } = latest.current;
    if (!stored || loaded.owner !== owner) return;
    const fresh = pruneTiers(stored, valid);
    if (sameStored(fresh, base)) return;
    const rebase = (x: TierState) => mergeTiers(base, fresh, x);
    const next = { state: mergeTiers(base, s, fresh), history: { past: h.past.map(rebase), future: h.future.map(rebase) }, synced: fresh };
    latest.current = { ...latest.current, ...next };
    setLoaded({ owner, ...next });
  });

  const commit = useCallback(
    (wanted: TierState, nextHistory: TierHistory, message: string, added: LineChoice[], retract: string[], recorded = true) => {
      // Into what's stored now: a tab that hadn't seen another's move doesn't write over it.
      const base = latest.current.synced;
      const stored = readTiers(userId, bidPackId);
      const next = mergeTiers(base, wanted, stored ? pruneTiers(stored, valid) : base);
      const nowSynced = saveTiers(userId, bidPackId, next) ? next : base;
      latest.current = { ...latest.current, state: next, history: nextHistory, synced: nowSynced };
      setLoaded({ owner, state: next, history: nextHistory, synced: nowSynced });
      setSaid(message);
      if (recorded) onRecord?.();
      if (added.length || retract.length) {
        const removed = teach.current?.(added, retract);
        for (const [moveId, choices] of Object.entries(removed ?? {})) {
          if (!choices.length || lessons.current.has(moveId)) continue;
          // As first taught: whether a later move set one aside is worked out again when it's given back.
          lessons.current.set(
            moveId,
            choices.map((c) => {
              const back = { ...c };
              delete back.supersededBy;
              return back;
            })
          );
        }
      }
    },
    [owner, userId, bidPackId, valid, teach, onRecord]
  );

  const numberOf = useCallback((id: string) => latest.current.rankedList.find((r) => r.line.id === id)?.line.lineNumber, []);

  /** A change to which tier lines are in: what it says is read off the list before and after. */
  const changeLines = useCallback(
    (change: (s: TierState) => TierState, moved: string[], teaches: boolean, message: string, swapped = false) => {
      const { state: s, history: h, rankedList: list } = latest.current;
      const idOf = (r: LineScore) => r.line.id;
      let next = change(s);
      const added: LineChoice[] = [];
      const retract: string[] = [];
      const taught = { ...s.taught };
      // A line's latest move is the pilot's word on it: whatever an earlier one said goes.
      for (const id of moved) {
        if (taught[id]) {
          if (!Object.entries(taught).some(([other, m]) => other !== id && m === taught[id] && !moved.includes(other))) retract.push(taught[id]);
          delete taught[id];
        }
      }
      if (teaches) {
        const before = applyTiers(list, s, idOf).map(idOf);
        const after = applyTiers(list, next, idOf).map(idOf);
        for (const l of lessonsFromMove(before, after, moved, numberOf, newMoveId(), bidPackId, swapped)) {
          lessons.current.set(l.moveId, l.choices);
          added.push(...l.choices);
          taught[l.lineId] = l.moveId;
        }
      }
      next = { ...next, taught };
      commit(next, pushHistory(h, s), message, added, retract);
    },
    [bidPackId, commit, numberOf]
  );

  const nameOf = useCallback((tierId: string | null) => (tierId === null ? "no tier" : (latest.current.state.tiers.find((t) => t.id === tierId)?.name ?? "")), []);
  const describe = useCallback(
    (lineIds: string[], where: string) => (lineIds.length === 1 ? `Line ${numberOf(lineIds[0]) ?? ""} moved to ${where}.` : `${lineIds.length} lines moved to ${where}.`),
    [numberOf]
  );

  const move = useCallback(
    (requested: string[], tierId: string | null) => {
      setSelected(new Set());
      const ids = linesThatWouldMove(latest.current.state, requested, tierId);
      if (ids.length === 0) return;
      changeLines((s) => moveToTier(s, ids, tierId), ids, tierId !== null, describe(ids, nameOf(tierId)));
    },
    [changeLines, describe, nameOf]
  );
  const park = useCallback(
    (ids: string[]) => {
      changeLines((s) => setAsideLines(s, ids), ids, false, ids.length === 1 ? `Line ${numberOf(ids[0]) ?? ""} set aside.` : `${ids.length} lines set aside.`);
      setSelected(new Set());
    },
    [changeLines, numberOf]
  );
  const unpark = useCallback((ids: string[]) => changeLines((s) => bringBack(s, ids), [], false, ids.length === 1 ? `Line ${numberOf(ids[0]) ?? ""} is back in the list.` : `${ids.length} lines are back in the list.`), [changeLines, numberOf]);
  const swap = useCallback((a: string, b: string) => changeLines((s) => swapTiers(s, a, b), [a, b], true, `Lines ${numberOf(a) ?? ""} and ${numberOf(b) ?? ""} traded tiers.`, true), [changeLines, numberOf]);

  // Names and the tier list change without saying anything about any line.
  const changeNames = useCallback(
    (change: (s: TierState) => TierState, message: string) => {
      const { state: s, history: h } = latest.current;
      const next = change(s);
      if (next !== s) commit(next, pushHistory(h, s), message, [], []);
    },
    [commit]
  );
  const rename = useCallback((tierId: string, name: string) => changeNames((s) => renameTier(s, tierId, name), `Tier renamed ${name.trim()}.`), [changeNames]);
  const add = useCallback((name: string) => changeNames((s) => addTier(s, name, newMoveId()), `Tier ${name.trim()} added.`), [changeNames]);
  const remove = useCallback((tierId: string) => changeNames((s) => removeTier(s, tierId), "Tier removed; its lines have no tier now."), [changeNames]);
  const clear = useCallback(() => {
    const { state: s, history: h } = latest.current;
    const next = clearTiers(s);
    commit(next, pushHistory(h, s), "All tiers cleared.", [], lessonChanges(s, next).retract);
    setSelected(new Set());
  }, [commit]);

  /** Back or forward: the brain's lessons follow the tiers, so what's undone is unlearned and what's redone relearned. */
  const travel = useCallback(
    (step: typeof undoTiers, word: string) => {
      const { state: s, history: h } = latest.current;
      const r = step(h, s);
      if (!r) return;
      const { retract, add: back } = lessonChanges(s, r.state);
      commit(r.state, r.history, word, back.flatMap((m) => lessons.current.get(m) ?? []), retract, false);
      setSelected(new Set());
    },
    [commit]
  );
  const undo = useCallback(() => travel(undoTiers, "Undone."), [travel]);
  const redo = useCallback(() => travel(redoTiers, "Redone."), [travel]);

  const toggleSelected = useCallback(
    (lineId: string, rangeOver?: string[]) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (rangeOver && anchor) {
          const [i, j] = [rangeOver.indexOf(anchor), rangeOver.indexOf(lineId)];
          if (i !== -1 && j !== -1) {
            for (const id of rangeOver.slice(Math.min(i, j), Math.max(i, j) + 1)) next.add(id);
            return next;
          }
        }
        if (next.has(lineId)) next.delete(lineId);
        else next.add(lineId);
        return next;
      });
      setAnchor(lineId);
    },
    [anchor]
  );
  const clearSelected = useCallback(() => setSelected(new Set()), []);

  const order = useCallback((list: LineScore[]) => applyTiers(list, state, (r) => r.line.id), [state]);
  const notBid = useMemo(() => notBidIds(state), [state]);
  const setAside = useMemo(() => new Set(state.setAside), [state]);
  const tierOf = useCallback((lineId: string) => state.assigned[lineId], [state]);

  return {
    state,
    inUse: hasTiers(state),
    order,
    notBid,
    setAside,
    tierOf,
    selected,
    toggleSelected,
    clearSelected,
    move,
    park,
    unpark,
    swap,
    rename,
    add,
    remove,
    clear,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    said,
    say: setSaid,
  };
}
