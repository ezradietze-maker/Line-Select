"use client";

import { useEffect, useState } from "react";
import { runInSlices } from "@/lib/ranking-warm-up";
import { vacationOptionTasks, type LineVacationOptions } from "@/lib/vacation-engine";
import { vacationId, type ChosenVacation } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";

/**
 * Every legal placement of the pilot's vacation on every line (`lib/vacation-engine.ts`), worked out in the background a
 * slice at a time once the page is up: on the biggest pack a second or two on a laptop, several on a phone, which in one
 * piece would freeze the page. Kept per pack and vacation, so a goal changed or the page reopened picks from it at once.
 * Null until it's done (and with no vacation to place).
 */

const kept = new WeakMap<BidPack, Map<string, Map<string, LineVacationOptions>>>();

const keyOf = (vacations: ChosenVacation[], carriedDays: Set<number>) =>
  `${vacations.map((v) => `${vacationId(v.vacation)}:${v.vacation.to}:${v.choice}`).join(",")}|${[...carriedDays].sort((a, b) => a - b).join(",")}`;

export function useVacationOptions(carriedPack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number>): { options: Map<string, LineVacationOptions> | null; share: number } {
  const active = vacations.filter((v) => v.choice !== "not-taking");
  const key = keyOf(active, carriedDays);
  const cached = active.length ? kept.get(carriedPack)?.get(key) ?? null : null;
  const [progress, setProgress] = useState<{ key: string; pack: BidPack; share: number; options: Map<string, LineVacationOptions> | null }>({ key, pack: carriedPack, share: 0, options: cached });
  const current = progress.key === key && progress.pack === carriedPack ? progress : { key, pack: carriedPack, share: 0, options: cached };

  useEffect(() => {
    if (!active.length || cached) return;
    const into = new Map<string, LineVacationOptions>();
    const stop = runInSlices(
      vacationOptionTasks(carriedPack, active, carriedDays, into),
      (share) => setProgress({ key, pack: carriedPack, share, options: null }),
      () => {
        let byKey = kept.get(carriedPack);
        if (!byKey) kept.set(carriedPack, (byKey = new Map()));
        byKey.set(key, into);
        setProgress({ key, pack: carriedPack, share: 1, options: into });
      }
    );
    return stop;
    // `active` and `carriedDays` are what `key` says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedPack, key, cached]);

  return { options: current.options, share: current.share };
}
