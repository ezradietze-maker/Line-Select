import type { BidPack } from "@/types/bidpack";
import type { LoggedMonth } from "@/types/logbook";
import type { PreferenceProfile } from "@/types/preferences";
import { isPackId, legacyPackIdFor } from "@/lib/pack-id";

/**
 * This month's bid, step by step: what's done ticks itself where the app can see it (the pack's loaded, the interview's
 * finished, the award's in the logbook); the one step only the pilot knows — that they entered the bid in the real
 * system — they tick themselves.
 */

export type ChecklistItemId = "pack" | "interview" | "entered" | "award";

export interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  done: boolean;
  /** The pilot ticks it themselves (the others follow what the app sees). */
  manual: boolean;
}

/** The logbook month for this pack: logged from it, or the same base, aircraft, seat and month. */
export function loggedMonthFor(profile: Pick<PreferenceProfile, "logbook">, pack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month">): LoggedMonth | null {
  return (
    profile.logbook?.find((m) => isPackId(m.bidPackId, pack)) ??
    profile.logbook?.find((m) => m.base === pack.base && m.aircraft === pack.aircraft && m.seat === pack.seat && m.month === pack.month) ??
    null
  );
}

export function bidChecklist(profile: PreferenceProfile, pack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month">): ChecklistItem[] {
  return [
    { id: "pack", label: "Bid pack uploaded", done: true, manual: false },
    { id: "interview", label: "Interview done", done: !!profile.pilotModel || !!profile.brainInterview?.reviewedModel, manual: false },
    { id: "entered", label: "Bid entered in the bid system", done: !!(profile.bidChecklist?.[pack.id] ?? profile.bidChecklist?.[legacyPackIdFor(pack)])?.enteredAt, manual: true },
    { id: "award", label: "Award logged", done: !!loggedMonthFor(profile, pack), manual: false },
  ];
}

/** The profile with "bid entered" ticked (or unticked) for this pack. */
export function withBidEntered(profile: PreferenceProfile, packId: string, entered: boolean, now: Date = new Date()): PreferenceProfile {
  const all = { ...profile.bidChecklist };
  if (entered) all[packId] = { ...all[packId], enteredAt: now.toISOString() };
  else {
    const rest = { ...all[packId] };
    delete rest.enteredAt;
    all[packId] = rest;
  }
  return { ...profile, bidChecklist: all };
}

/** Reminders before the bid closes: the day before and an hour before. */
export const REMINDER_LEADS = [
  { ms: 24 * 3_600_000, text: "Bid closes tomorrow" },
  { ms: 3_600_000, text: "Bid closes in an hour" },
] as const;

/** Browsers can't hold a timer longer than about 24.8 days (a 32-bit millisecond count). */
const MAX_TIMER_MS = 2_147_483_647;

/** The reminders still to come for a deadline, with how long until each — the ones a timer can hold from now. */
export function upcomingReminders(deadline: string, now: number = Date.now()): { inMs: number; text: string }[] {
  const at = new Date(deadline).getTime();
  if (!Number.isFinite(at)) return [];
  return REMINDER_LEADS.map((r) => ({ inMs: at - r.ms - now, text: r.text })).filter((r) => r.inMs > 0 && r.inMs <= MAX_TIMER_MS);
}
