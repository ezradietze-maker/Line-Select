"use client";

import { useCallback, useMemo, useState } from "react";
import { loadCarryIn, saveCarryIn, type CarryInState } from "@/lib/carry-in-storage";
import { flyPack } from "@/lib/phase-in";
import type { BidPack } from "@/types/bidpack";

/** The pilot's carry-in for this pack, and the pack as it will fly because of it. */
export function useCarryIn(bidPack: BidPack, userId: string | null) {
  const owner = `${userId}|${bidPack.id}`;
  const [kept, setKept] = useState(() => ({ owner, state: loadCarryIn(userId, bidPack.id) }));
  const state = kept.owner === owner ? kept.state : loadCarryIn(userId, bidPack.id);
  if (kept.owner !== owner) setKept({ owner, state });

  const update = useCallback(
    (next: CarryInState) => {
      saveCarryIn(userId, bidPack.id, next);
      setKept({ owner: `${userId}|${bidPack.id}`, state: next });
    },
    [userId, bidPack.id]
  );
  const flown = useMemo(() => flyPack(bidPack, state.items, state.elections), [bidPack, state]);
  return { state, update, flown };
}

export type CarryIn = ReturnType<typeof useCarryIn>;
