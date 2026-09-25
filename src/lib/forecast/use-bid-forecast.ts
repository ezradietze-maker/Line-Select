"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [result, setResult] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);

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
      const response = await fetchForecast({ bidPack, features, seniorityNumber, rankingLineIds, share: sharing && !!userId });
      if (cancelled) return;
      setResult(response);
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
      try {
        window.localStorage.setItem(shareKey(userId), next ? "on" : "off");
      } catch {
        // preference just won't persist
      }
      if (!next) void stopSharingRanking(forecastPackKey(bidPack), features.lineNumbers);
    },
    [userId, bidPack, features]
  );

  return { result: active ? result : null, loading: active && loading, sharing, setSharing, canShare: !!userId };
}
