"use client";

import { useCallback, useMemo, useState } from "react";
import { loadCarryIn, saveCarryIn, type CarryInState } from "@/lib/carry-in-storage";
import { flySchedule, pilotVacations, withChoices } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

/** The pilot's carry-in and vacation for this pack, and the pack as it will fly because of them. */
export function useCarryIn(bidPack: BidPack, userId: string | null, profile: Pick<PreferenceProfile, "seniorityNumber"> | null, seniority: SeniorityInput | null) {
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
  // The place the pilot saved on Strategies, as the app holds it now: read from storage, a number given since didn't count
  // until the page was opened again.
  const { typedVacations, preferTyped } = state;
  const vacations = useMemo(() => pilotVacations(bidPack, { seniorityNumber }, seniority, { typedVacations, preferTyped }), [bidPack, seniorityNumber, seniority, typedVacations, preferTyped]);
  const chosen = useMemo(() => withChoices(vacations.vacations, state.vacationChoices), [vacations, state.vacationChoices]);
  const flown = useMemo(() => flySchedule(bidPack, state, chosen), [bidPack, state, chosen]);
  return { state, update, flown, vacations, chosen };
}

export type CarryIn = ReturnType<typeof useCarryIn>;
