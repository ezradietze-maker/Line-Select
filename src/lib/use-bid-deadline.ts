"use client";

import { useSyncExternalStore } from "react";
import { getBidDeadline, subscribeBidDeadline } from "@/lib/bid-deadline-storage";

/**
 * The pilot's own bid close for this pack, kept up to date: read once in render, a time set on another part of the
 * screen never reached what read it (the calendar link kept sending the old one). Null on the server and first paint.
 * In a file of its own: the storage it reads is also imported by server code (the calendar feed), where a React hook
 * can't be.
 */
export function useBidDeadlineOverride(bidPackId: string | null): string | null {
  return useSyncExternalStore(subscribeBidDeadline, () => (bidPackId ? getBidDeadline(bidPackId) : null), () => null);
}
