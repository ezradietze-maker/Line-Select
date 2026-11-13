import type { AwardHistorySubmission, AwardSummaryResponse, HeldByView } from "@/types/award-history";
import type { BidPack, SeniorityEntry } from "@/types/bidpack";
import type { SeniorityInput } from "@/types/strategy";

/** 1 = most senior, 0 = least — comparable across different totalPilots counts, unlike the raw rank number. */
export function seniorityPercentile(input: SeniorityInput): number {
  if (input.totalPilots <= 1) return 1;
  return 1 - (input.rank - 1) / (input.totalPilots - 1);
}

/** Different pilots needed before anything is shown for a group. Agreed with the owner: 5, since "held by" shows exact seniority numbers. */
export const MIN_SHARED_PILOTS = 5;

/** The slices of a seat's list that group numbers are reported for. Fixed and not overlapping, so comparing two of them can never single out one pilot's report. */
export const AWARD_BANDS = 4;

/** Which slice a pilot falls in, 0 = the most senior quarter. */
export function awardBandOf(input: SeniorityInput): number {
  return Math.min(AWARD_BANDS - 1, Math.floor((1 - seniorityPercentile(input)) * AWARD_BANDS));
}

export interface AwardHistorySummary {
  totalReports: number;
  nearbyCount: number;
  /** Only present once enough different pilots near this seniority have reported. */
  avgDaysOff: number | null;
  avgCreditHours: number | null;
  lineRate: number | null;
}

/** What a pilot at a given seniority can honestly learn: the group numbers for their own slice of the list. Worked out here, so their seniority is never sent to ask. */
export function summaryForSeniority(data: AwardSummaryResponse, seniority: SeniorityInput): AwardHistorySummary {
  const band = data.bands[awardBandOf(seniority)];
  return {
    totalReports: data.totalReports,
    nearbyCount: band?.reports ?? 0,
    avgDaysOff: band?.avgDaysOff ?? null,
    avgCreditHours: band?.avgCreditHours ?? null,
    lineRate: band?.lineRate ?? null,
  };
}

/**
 * The pilot's own entry on the pack's list, when their seniority number is on it. Only then is their place exact, and
 * only then can it be shown as "held by seniority #N".
 */
export function ownListEntry(bidPack: Pick<BidPack, "seniorityList"> | null, seniorityNumber: number | null | undefined): SeniorityEntry | null {
  if (!seniorityNumber) return null;
  return bidPack?.seniorityList?.find((e) => e.seniority === seniorityNumber) ?? null;
}

export async function fetchAwardSummary(base: string, aircraft: string, seat: string): Promise<AwardSummaryResponse> {
  try {
    const res = await fetch(`/api/award-history?${new URLSearchParams({ base, aircraft, seat }).toString()}`);
    if (!res.ok) return { totalReports: 0, bands: [] };
    return (await res.json()) as AwardSummaryResponse;
  } catch {
    return { totalReports: 0, bands: [] };
  }
}

/** Who held what for this pack, as far as pilots have agreed to show it. Needs a signed-in pilot. */
export async function fetchHeldBy(pack: { base: string; aircraft: string; seat: string; month: string }): Promise<HeldByView | null> {
  try {
    const res = await fetch(`/api/award-history/held-by?${new URLSearchParams(pack).toString()}`);
    if (!res.ok) return null;
    return (await res.json()) as HeldByView;
  } catch {
    return null;
  }
}

/** Takes back one month's share, or with no month, every share this pilot has made. */
export async function withdrawAwardShares(month?: { base: string; aircraft: string; seat: string; month: string }): Promise<{ ok: boolean; removed?: number; error?: string }> {
  try {
    const res = await fetch("/api/award-history", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(month ?? {}) });
    const data = (await res.json().catch(() => null)) as { removed?: number; error?: string } | null;
    if (!res.ok) return { ok: false, error: data?.error ?? "Something went wrong. Try again." };
    return { ok: true, removed: data?.removed ?? 0 };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** `confirmEmail`: refused because the pilot's email isn't confirmed; the app shows its "Confirm your email" button. */
export async function submitAwardHistory(
  submission: AwardHistorySubmission
): Promise<{ ok: boolean; error?: string; confirmEmail?: boolean }> {
  try {
    const res = await fetch("/api/award-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: false, error: data?.error ?? "Something went wrong. Try again.", confirmEmail: data?.confirmEmail === true };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
