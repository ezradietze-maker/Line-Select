"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLineFeatures } from "@/lib/forecast/features";
import { forecastPackKey } from "@/lib/forecast/forecast";
import { fetchForecast, stopSharingRanking, type ForecastResponse } from "@/lib/forecast/forecast-client";
import type { BidPack } from "@/types/bidpack";

function shareKey(userId: string): string {
  return `line-select:forecast-share:${userId}`;
}

function loadSharing(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(shareKey(userId)) !== "off";
  } catch {
    return true;
  }
}

function saveSharing(userId: string, next: boolean): void {
  try {
    window.localStorage.setItem(shareKey(userId), next ? "on" : "off");
  } catch {
    // preference just won't persist
  }
}

interface Params {
  bidPack: BidPack;
  /** Line ids in the pilot's own ranking, best first. Empty while it isn't ready. */
  rankingLineIds: string[];
  implicitValuesByLine: Record<string, Record<string, number>>;
  seniorityNumber: number | null | undefined;
  userId: string | null;
  enabled: boolean;
}

/**
 * The bid forecast for the current pilot and ranking: runs when the pilot's
 * ranking (or seniority number) changes, and shares their ranking with the
 * forecast for other pilots unless they've turned that off.
 */
export function useBidForecast({ bidPack, rankingLineIds, implicitValuesByLine, seniorityNumber, userId, enabled }: Params) {
  const features = useMemo(() => buildLineFeatures(bidPack, implicitValuesByLine), [bidPack, implicitValuesByLine]);
  const [sharing, setSharingState] = useState(() => (typeof window === "undefined" ? false : loadSharing(userId)));
  const [result, setResult] = useState<(ForecastResponse & { seniorityNumber: number }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Ticked again by the pilot: the next forecast says so, and the server stops holding them as stopped (see the route).
  const resume = useRef(false);

  const rankingKey = rankingLineIds.join(",");
  const active = enabled && !!seniorityNumber && !!bidPack.seniorityList?.length && rankingLineIds.length > 0;

  useEffect(() => {
    if (!active || !seniorityNumber) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const response = await fetchForecast({ bidPack, features, seniorityNumber, rankingLineIds, share: sharing && !!userId, resume: resume.current });
      if (cancelled) return;
      if (response && !response.local) resume.current = false;
      // Stopped on another device, or on this one before signing out (each starts ticked): unticked here too.
      if (response?.shared === "off" && userId) {
        saveSharing(userId, false);
        setSharingState(false);
      }
      setResult(response ? { ...response, seniorityNumber } : null);
      setFailed(!response);
      setLoading(false);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // rankingKey stands in for rankingLineIds so an identical ranking doesn't re-run the forecast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bidPack, features, seniorityNumber, rankingKey, sharing, userId]);

  const setSharing = useCallback(
    (next: boolean) => {
      setSharingState(next);
      if (!userId) return;
      saveSharing(userId, next);
      resume.current = next;
      if (!next) void stopSharingRanking(forecastPackKey(bidPack), features.lineNumbers);
    },
    [userId, bidPack, features]
  );

  // A forecast belongs to one pack and one seniority number; while a new one is being worked out after either changes, showing the old one would put last month's chances (or someone else's position) on this pack's cards.
  const current =
    result && result.forecast.packKey === forecastPackKey(bidPack) && result.seniorityNumber === seniorityNumber
      ? result
      : null;

  return { failed: active && failed && !current, result: active ? current : null, loading: active && loading, sharing, setSharing, canShare: !!userId };
}
