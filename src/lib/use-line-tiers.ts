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
  moveToTier,
  notBidIds,
  pruneTiers,
  pushHistory,
  redoTiers,
  removeTier,
  renameTier,
  saveTiers,
  setAsideLines,
  swapTiers,
  undoTiers,
  type TierHistory,
  type TierState,
} from "@/lib/line-tiers";
import type { LineScore } from "@/lib/scoring";
import type { LineChoice } from "@/types/pilot-model";

/** Hands what a tier move taught to the brain: choices to add and moves whose choices no longer count. */
export type TeachTiers = (add: LineChoice[], retract: string[]) => void;

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
  teach: { current: TeachTiers | null }
): LineTiers {
  const owner = `${userId}|${bidPackId}`;
  const valid = useMemo(() => new Set(lineIds), [lineIds]);
  const [loaded, setLoaded] = useState(() => ({ owner, state: pruneTiers(loadTiers(userId, bidPackId), valid), history: EMPTY_HISTORY as TierHistory }));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const lessons = useRef(new Map<string, LineChoice[]>());
  if (loaded.owner !== owner) {
    setLoaded({ owner, state: pruneTiers(loadTiers(userId, bidPackId), valid), history: EMPTY_HISTORY });
    setSelected(new Set());
    setAnchor(null);
    setSaid("");
  }
  const { state, history } = loaded;

  // The newest of everything, for a move made from a keyboard handler or a callback that was set up a render ago.
  const latest = useRef({ state, history, rankedList });
  useEffect(() => {
    latest.current = { state, history, rankedList };
  }, [state, history, rankedList]);

  const commit = useCallback(
    (next: TierState, nextHistory: TierHistory, message: string, added: LineChoice[], retract: string[]) => {
      latest.current = { ...latest.current, state: next, history: nextHistory };
      setLoaded({ owner, state: next, history: nextHistory });
      saveTiers(userId, bidPackId, next);
      setSaid(message);
      if (added.length || retract.length) teach.current?.(added, retract);
    },
    [owner, userId, bidPackId, teach]
  );

  const numberOf = useCallback((id: string) => latest.current.rankedList.find((r) => r.line.id === id)?.line.lineNumber, []);

  /** A change to which tier lines are in: what it says is read off the list before and after. */
  const changeLines = useCallback(
    (change: (s: TierState) => TierState, moved: string[], teaches: boolean, message: string) => {
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
        for (const l of lessonsFromMove(before, after, moved, numberOf, newMoveId(), bidPackId)) {
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
  const swap = useCallback((a: string, b: string) => changeLines((s) => swapTiers(s, a, b), [a, b], true, `Lines ${numberOf(a) ?? ""} and ${numberOf(b) ?? ""} traded tiers.`), [changeLines, numberOf]);

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
      commit(r.state, r.history, word, back.flatMap((m) => lessons.current.get(m) ?? []), retract);
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
  };
}
