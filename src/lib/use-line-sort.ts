"use client";

import { useCallback, useMemo, useState } from "react";
import {
  applySort,
  buildSortContext,
  LINE_SORTS_BY_ID,
  loadSortChoice,
  MATCH_SORT,
  resolveSort,
  saveSortChoice,
  sortValueForLine,
  type SortChoice,
  type SortContext,
  type SortDef,
} from "@/lib/line-sorts";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import type { MonthDepartureOptions } from "@/lib/month-detail";
import type { LineScore } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

export interface LineSort {
  choice: SortChoice;
  def: SortDef;
  /** The pilot's own ranked order: the only one a drag means anything in. */
  isRanking: boolean;
  choose: (next: SortChoice) => void;
  /** Measures are worked out only once a sort or the menu needs them. */
  ctx: SortContext | null;
  prepare: () => void;
  apply: (list: LineScore[]) => LineScore[];
  valueFor: (lineId: string) => string | null;
  key: string;
}

/** The list's sort: remembered for each pack, and measured only when the pilot asks for something other than the ranking. */
export function useLineSort(
  userId: string | null,
  bidPack: BidPack,
  profile: PreferenceProfile,
  flights: FlightAnswers | null,
  departureOptions: MonthDepartureOptions
): LineSort {
  const [choice, setChoice] = useState<SortChoice>(() => loadSortChoice(userId, bidPack.id));
  const [prepared, setPrepared] = useState(false);
  const owner = `${userId}|${bidPack.id}`;
  const [loadedFor, setLoadedFor] = useState(owner);
  if (owner !== loadedFor) {
    setLoadedFor(owner);
    setChoice(loadSortChoice(userId, bidPack.id));
  }

  const needed = prepared || LINE_SORTS_BY_ID.get(choice.id)?.group !== "order";
  const facts = useMemo(() => (needed ? prepareMetrics(bidPack) : null), [needed, bidPack]);
  const ctx = useMemo(() => {
    if (!facts) return null;
    const pack = flights ? { ...facts, ctx: { ...facts.ctx, flights } } : facts;
    return buildSortContext(bidPack, profile, pack, departureOptions);
  }, [facts, flights, bidPack, profile, departureOptions]);

  const def = resolveSort(choice, ctx);
  const isRanking = def.id === MATCH_SORT && !(choice.id === MATCH_SORT && choice.reversed);
  const choose = useCallback(
    (next: SortChoice) => {
      setChoice(next);
      saveSortChoice(userId, bidPack.id, next);
    },
    [userId, bidPack.id]
  );
  const prepare = useCallback(() => setPrepared(true), []);
  const apply = useCallback((list: LineScore[]) => applySort(list, choice, ctx), [choice, ctx]);
  const valueFor = useCallback((lineId: string) => (ctx ? sortValueForLine(def, choice, ctx, lineId) : null), [def, choice, ctx]);
  const key = `${choice.id}/${choice.reversed ? "r" : ""}/${choice.city ?? ""}/${choice.region ?? ""}`;

  return { choice, def, isRanking, choose, ctx, prepare, apply, valueFor, key };
}
