import type { AwardHistoryRecord, AwardHistorySubmission } from "@/types/award-history";
import type { SeniorityInput } from "@/types/strategy";

/** 1 = most senior, 0 = least — comparable across different totalPilots counts, unlike the raw rank number. */
export function seniorityPercentile(input: SeniorityInput): number {
  if (input.totalPilots <= 1) return 1;
  return 1 - (input.rank - 1) / (input.totalPilots - 1);
}

/** Within this many percentile points either side counts as "near your seniority" — wide enough that a small early dataset still has anything to show, narrow enough that a #5-of-200 report doesn't get compared against a #190-of-200 one. */
const NEARBY_PERCENTILE_WINDOW = 0.15;

/** Below this many nearby line-outcome reports, a summary would look more precise than the sample actually supports. */
const MIN_SAMPLE_SIZE = 3;

export interface AwardHistorySummary {
  totalReports: number;
  nearbyCount: number;
  /** Only present once nearbyCount reaches MIN_SAMPLE_SIZE. */
  avgDaysOff: number | null;
  avgCreditHours: number | null;
  lineRate: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * What a pilot at a given seniority can honestly learn from everyone who's
 * already reported for this base/aircraft/seat — deliberately conservative:
 * every derived number stays null until there's enough nearby data to back
 * it, rather than showing a number built from one or two reports as if it
 * meant something.
 */
export function summarizeAwardHistory(
  records: AwardHistoryRecord[],
  seniority: SeniorityInput
): AwardHistorySummary {
  const myPercentile = seniorityPercentile(seniority);
  const nearby = records.filter(
    (r) => Math.abs(seniorityPercentile({ rank: r.seniorityRank, totalPilots: r.seniorityTotalPilots }) - myPercentile) <=
      NEARBY_PERCENTILE_WINDOW
  );
  const nearbyLineReports = nearby.filter((r) => r.outcome === "line");

  const enoughData = nearbyLineReports.length >= MIN_SAMPLE_SIZE;

  return {
    totalReports: records.length,
    nearbyCount: nearby.length,
    avgDaysOff: enoughData
      ? average(nearbyLineReports.map((r) => r.daysOff).filter((v): v is number => v !== null))
      : null,
    avgCreditHours: enoughData
      ? average(nearbyLineReports.map((r) => r.totalCreditHours).filter((v): v is number => v !== null))
      : null,
    lineRate: nearby.length >= MIN_SAMPLE_SIZE ? nearbyLineReports.length / nearby.length : null,
  };
}

export async function fetchAwardHistory(
  base: string,
  aircraft: string,
  seat: string
): Promise<AwardHistoryRecord[]> {
  try {
    const res = await fetch(
      `/api/award-history?${new URLSearchParams({ base, aircraft, seat }).toString()}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { records: AwardHistoryRecord[] };
    return data.records;
  } catch {
    return [];
  }
}

export async function submitAwardHistory(
  submission: AwardHistorySubmission
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/award-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: false, error: data?.error ?? "Something went wrong. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
