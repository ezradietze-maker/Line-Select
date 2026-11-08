"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canCheckCommute,
  commuteStatuses,
  DEFAULT_COMMUTE_SETTINGS,
  loadCommuteAnswers,
  runCommuteCheck,
  type CommuteAnswers,
  type CommuteCheckEnd,
  type CommuteSettings,
} from "@/lib/commute-filter";
import type { CommuteStatus } from "@/lib/line-filters";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

export interface CommuteCheck {
  settings: CommuteSettings;
  update: (next: Partial<CommuteSettings>) => void;
  canCheck: boolean;
  statuses: Map<string, CommuteStatus>;
  phase: "idle" | "checking" | CommuteCheckEnd;
  done: number;
  total: number;
  counts: Record<CommuteStatus, number>;
}

const SETTINGS_KEY = "line-select:commute-settings:v1";

function startingSettings(profile: PreferenceProfile): CommuteSettings {
  const h = profile.pilotModel?.home;
  const fromProfile: CommuteSettings = {
    ...DEFAULT_COMMUTE_SETTINGS,
    homeAirport: h?.airports[0] ?? (profile.isCommuter ? profile.commuteFrom : null) ?? "",
    ...(h?.commuteBufferHours !== undefined ? { arriveBeforeReportHours: h.commuteBufferHours } : {}),
  };
  if (typeof window === "undefined") return fromProfile;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<CommuteSettings>) : {};
    return {
      homeAirport: typeof s.homeAirport === "string" && s.homeAirport ? s.homeAirport : fromProfile.homeAirport,
      arriveBeforeReportHours: typeof s.arriveBeforeReportHours === "number" ? s.arriveBeforeReportHours : fromProfile.arriveBeforeReportHours,
      releaseToDepartureHours: typeof s.releaseToDepartureHours === "number" ? s.releaseToDepartureHours : fromProfile.releaseToDepartureHours,
      jumpseats: typeof s.jumpseats === "boolean" ? s.jumpseats : fromProfile.jumpseats,
    };
  } catch {
    return fromProfile;
  }
}

/** The commute filter's flight check: runs while the filter is on, resuming from what's kept, and only then. */
export function useCommuteCheck(bidPack: BidPack, profile: PreferenceProfile, on: boolean): CommuteCheck {
  const [settings, setSettings] = useState<CommuteSettings>(() => startingSettings(profile));
  const [answers, setAnswers] = useState<CommuteAnswers>({});
  const [run, setRun] = useState<{ phase: CommuteCheck["phase"]; done: number; total: number }>({ phase: "idle", done: 0, total: 0 });
  const canCheck = canCheckCommute(bidPack, settings.homeAirport);

  const update = useCallback((next: Partial<CommuteSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      } catch {
        // storage unavailable — the settings just won't be remembered
      }
      return merged;
    });
  }, []);

  useEffect(() => {
    if (!on || !canCheck) return;
    const stop = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswers(loadCommuteAnswers(bidPack.id, settings));
    setRun({ phase: "checking", done: 0, total: 0 });
    runCommuteCheck(
      bidPack,
      settings,
      (p) => {
        if (stop.signal.aborted) return;
        setAnswers(p.answers);
        setRun({ phase: "checking", done: p.done, total: p.total });
      },
      { signal: stop.signal }
    ).then((end) => {
      if (!stop.signal.aborted) setRun((r) => ({ ...r, phase: end }));
    });
    return () => stop.abort();
  }, [on, canCheck, bidPack, settings]);

  const statuses = useMemo(() => (on && canCheck ? commuteStatuses(bidPack, settings, answers) : new Map<string, CommuteStatus>()), [on, canCheck, bidPack, settings, answers]);
  const counts = useMemo(() => {
    const c: Record<CommuteStatus, number> = { yes: 0, no: 0, unknown: 0 };
    for (const s of statuses.values()) c[s]++;
    return c;
  }, [statuses]);

  return { settings, update, canCheck, statuses, phase: run.phase, done: run.done, total: run.total, counts };
}
