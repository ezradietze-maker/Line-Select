"use client";

import { useEffect } from "react";
import { loggedMonthFor } from "@/lib/bid-checklist";
import { fetchServerBidPackMeta, saveServerBidPack } from "@/lib/bidpack-server";
import { bidPackSavedAt } from "@/lib/bidpack-storage";
import { getBidDeadline, useBidDeadlineOverride } from "@/lib/bid-deadline-storage";
import type { LineSource } from "@/lib/calendar-feed";
import { isSamplePack } from "@/lib/fake-trade-offers";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The browser's side of the calendar link. Which line is #1 is only known here (it weighs the flights kept on this
 * device and the lines moved by hand), so the browser tells the server when it changes; the server does nothing with
 * that unless the pilot has a live link.
 */

export interface FeedStatusView {
  on: boolean;
  createdAt?: string;
  options?: { homeDays: boolean };
  month?: string | null;
  lineNumber?: string | null;
  lineSource?: LineSource | null;
  /** Only in the answer to making a link: the one time it's sent. */
  url?: string;
}

const PATH = "/api/calendar-feed";

async function send(method: string, body?: unknown): Promise<Response> {
  return fetch(PATH, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function statusFrom(res: Response): Promise<FeedStatusView> {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error ?? "Couldn't reach your calendar link just now.");
  return json as FeedStatusView;
}

export const fetchFeedStatus = async () => statusFrom(await fetch(PATH));
export const makeFeedLink = async (homeDays?: boolean) => statusFrom(await send("POST", homeDays === undefined ? {} : { homeDays }));
export const setFeedHomeDays = async (homeDays: boolean) => statusFrom(await send("PATCH", { homeDays }));
export const turnOffFeed = async () => statusFrom(await send("DELETE"));

/** Where each calendar app takes a subscription from this link. */
export function feedLinks(url: string): { apple: string; google: string; outlook: string } {
  const webcal = url.replace(/^https?:/, "webcal:");
  return {
    apple: webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent("Line Select")}`,
  };
}

/** The line this pack's month should show: the award once it's logged, otherwise the current #1. */
export function feedChoiceFor(pack: BidPack, profile: PreferenceProfile | null, topLineNumber: string | null): { lineNumber: string | null; lineSource: LineSource | null } | null {
  const logged = profile ? loggedMonthFor(profile, pack) : null;
  if (logged) return { lineNumber: logged.outcome === "line" ? (logged.lineNumber ?? null) : null, lineSource: "awarded" };
  return topLineNumber ? { lineNumber: topLineNumber, lineSource: "top" } : null;
}

export type FeedSyncResult = "off" | "pack-not-saved" | "ok" | "failed";

/**
 * Sends the pilot's line. The feed is built from the pack on their account, and that can be missing: a pack is only saved
 * there when it's uploaded while signed in, so one from before that, still on this device, has never been. It goes up here,
 * unless the account holds another pack saved after this device's copy: a new month uploaded on the laptop isn't put
 * back to last month's by a phone that hasn't caught up (the phone picks the new one up on its next load).
 */
export async function syncFeedChoice(pack: BidPack, profile: PreferenceProfile | null, topLineNumber: string | null, userId: string | null = null): Promise<FeedSyncResult> {
  const choice = feedChoiceFor(pack, profile, topLineNumber) ?? { lineNumber: null, lineSource: null };
  const sendChoice = async (): Promise<FeedSyncResult> => {
    const res = await send("PUT", { packId: pack.id, ...choice, pilotClose: getBidDeadline(pack.id) });
    if (!res.ok) return "failed";
    return ((await res.json()) as { result: FeedSyncResult }).result;
  };
  try {
    const result = await sendChoice();
    if (result !== "pack-not-saved") return result;
    const account = await fetchServerBidPackMeta();
    if (account && account.packId !== pack.id && account.savedAt > bidPackSavedAt(userId)) return result;
    return (await saveServerBidPack(pack)) ? await sendChoice() : result;
  } catch {
    return "failed";
  }
}

const SENT_KEY = "line-select:calendar-feed-sent:v1";
/** Long enough that dragging lines around sends only where they end up. */
const SETTLE_MS = 3000;

const lastSent = () => {
  try {
    return localStorage.getItem(SENT_KEY);
  } catch {
    return null;
  }
};
function rememberSent(value: string | null) {
  try {
    if (value) localStorage.setItem(SENT_KEY, value);
    else localStorage.removeItem(SENT_KEY);
  } catch {
    // Just means sending again next time.
  }
}

/** Forgets what was last sent, so the next look at the page sends again: for a new link. */
export const forgetFeedSync = () => rememberSent(null);

/**
 * Tells the server when the pilot's line changes, and once a day regardless: flights cached since the last time then
 * reach the calendar. A guest, the sample pack (never stored) or a screen with no line to give sends nothing.
 */
export function useCalendarFeedSync(pack: BidPack | null, profile: PreferenceProfile | null, userId: string | null, topLineNumber: string | null): void {
  const choice = pack ? feedChoiceFor(pack, profile, topLineNumber) : null;
  const lineNumber = choice?.lineNumber ?? null;
  const lineSource = choice?.lineSource ?? null;
  // Watched, so a deadline the pilot sets or clears anywhere on the page is sent too: it's on the calendar.
  const deadline = useBidDeadlineOverride(pack?.id ?? null);
  useEffect(() => {
    if (!userId || !pack || !lineSource || isSamplePack(pack)) return;
    const day = new Date().toISOString().slice(0, 10);
    const signature = [userId, pack.id, lineNumber, lineSource, deadline, day].join("|");
    if (lastSent() === signature) return;
    const timer = window.setTimeout(() => {
      void syncFeedChoice(pack, profile, topLineNumber, userId).then((result) => {
        // A pack not saved yet, or a failure, tries again next time.
        if (result === "ok" || result === "off") rememberSent(signature);
      });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature's parts: the profile matters only through them.
  }, [userId, pack?.id, lineNumber, lineSource, deadline]);
}
