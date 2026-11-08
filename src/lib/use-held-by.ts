"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHeldBy, ownListEntry } from "@/lib/award-history";
import { isSamplePack } from "@/lib/fake-trade-offers";
import type { HeldByView } from "@/types/award-history";
import type { BidPack } from "@/types/bidpack";

/** What the opened line card says: who held the line, and how far the odds have been checked. */
export interface HeldByNoteData {
  holder: { seniority: number | null; bidPosition: number; relation: "you" | "senior" | "junior" | null } | null;
  oddsCheckedAgainst: number | null;
}

/**
 * Who held this pack's lines, as a lookup by line number. The server sends bid positions; each is turned into a
 * seniority number with the pack's own list, here in the browser. Asked once per pack, signed-in pilots only. Returns
 * the same object for a line each time, so a memoized card isn't redrawn.
 */
export function useHeldBy(bidPack: BidPack, userId: string | null, seniorityNumber: number | null | undefined): (lineNumber: string) => HeldByNoteData | null {
  const ask = userId && !isSamplePack(bidPack) ? { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, month: bidPack.month } : null;
  const askKey = ask ? `${ask.base}|${ask.aircraft}|${ask.seat}|${ask.month}` : null;
  const [answer, setAnswer] = useState<{ key: string; view: HeldByView } | null>(null);
  useEffect(() => {
    if (!askKey) return;
    let cancelled = false;
    const [base, aircraft, seat, month] = askKey.split("|");
    fetchHeldBy({ base, aircraft, seat, month }).then((view) => {
      if (!cancelled && view) setAnswer({ key: askKey, view });
    });
    return () => {
      cancelled = true;
    };
  }, [askKey]);

  const view = answer && answer.key === askKey ? answer.view : null;
  const myPlace = ownListEntry(bidPack, seniorityNumber)?.bidNumber ?? null;
  const notes = useMemo(() => {
    const byLine = new Map<string, HeldByNoteData>();
    if (!view) return { byLine, rest: null };
    const oddsCheckedAgainst = view.oddsCheckedAgainst;
    for (const { lineNumber, bidPosition } of view.holders) {
      const seniority = bidPack.seniorityList?.find((e) => e.bidNumber === bidPosition)?.seniority ?? null;
      const relation = myPlace === null ? null : bidPosition === myPlace ? "you" : bidPosition < myPlace ? "senior" : "junior";
      byLine.set(lineNumber, { holder: { seniority, bidPosition, relation }, oddsCheckedAgainst });
    }
    return { byLine, rest: oddsCheckedAgainst ? { holder: null, oddsCheckedAgainst } : null };
  }, [view, bidPack.seniorityList, myPlace]);
  return useCallback((lineNumber: string) => notes.byLine.get(lineNumber) ?? notes.rest, [notes]);
}
