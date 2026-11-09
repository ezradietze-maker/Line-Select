"use client";

import { useCallback, useMemo, useState } from "react";
import { loadCarryIn, saveCarryIn, type CarryInState } from "@/lib/carry-in-storage";
import { loadSeniority } from "@/lib/seniority-storage";
import { flySchedule, pilotVacations, withChoices } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/** The pilot's carry-in and vacation for this pack, and the pack as it will fly because of them. */
export function useCarryIn(bidPack: BidPack, userId: string | null, profile: Pick<PreferenceProfile, "seniorityNumber"> | null) {
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
  const seniorityNumber = profile?.seniorityNumber;
  const vacations = useMemo(() => pilotVacations(bidPack, { seniorityNumber }, loadSeniority(userId)), [bidPack, seniorityNumber, userId]);
  const flown = useMemo(() => flySchedule(bidPack, state, withChoices(vacations.vacations, state.vacationChoices)), [bidPack, state, vacations]);
  return { state, update, flown, vacations };
}

export type CarryIn = ReturnType<typeof useCarryIn>;
