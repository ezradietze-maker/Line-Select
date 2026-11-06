/**
 * The real-outcome score: how the months the brain ranked actually flew, by the pilots' own check-ins — the
 * yardstick every brain change is judged by in the end, since tests and simulated pilots only stand in for it.
 * Two numbers per brain version: the share of flown months rated as expected or better, and where the line pilots
 * got sat in their own ranking (the median; 1 = their top line).
 */

export interface FlownCheckIn {
  feel: "better" | "asExpected" | "worse";
  brainVersion: number | null;
  awardedChoice: number | null;
}

export interface VersionScore {
  brainVersion: number | null;
  months: number;
  /** Share of months rated as expected or better; null below `MIN_MONTHS`. */
  asExpectedOrBetter: number | null;
  /** Median place of the held line in the pilot's own ranking; null below `MIN_MONTHS` or with no lines. */
  medianRank: number | null;
}

/** Months a brain version needs before its score means anything. */
export const MIN_MONTHS = 10;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Newest brain version first; months with no recorded version last. */
export function scoreByVersion(months: FlownCheckIn[]): VersionScore[] {
  const groups = new Map<number | null, FlownCheckIn[]>();
  for (const m of months) groups.set(m.brainVersion, [...(groups.get(m.brainVersion) ?? []), m]);
  return [...groups.entries()]
    .map(([brainVersion, ms]) => {
      const enough = ms.length >= MIN_MONTHS;
      return {
        brainVersion,
        months: ms.length,
        asExpectedOrBetter: enough ? ms.filter((m) => m.feel !== "worse").length / ms.length : null,
        medianRank: enough ? median(ms.map((m) => m.awardedChoice).filter((r): r is number => typeof r === "number")) : null,
      };
    })
    .sort((a, b) => (b.brainVersion ?? -1) - (a.brainVersion ?? -1));
}

export function describeScores(scores: VersionScore[]): string[] {
  if (!scores.length) return ["No flown months checked in yet."];
  return scores.map((s) => {
    const name = s.brainVersion ? `Brain v${s.brainVersion}` : "Before versions were recorded";
    if (s.asExpectedOrBetter === null) return `${name}: ${s.months} month${s.months === 1 ? "" : "s"} checked in (a score shows at ${MIN_MONTHS})`;
    return `${name}: ${Math.round(s.asExpectedOrBetter * 100)}% of ${s.months} months flew as expected or better${s.medianRank !== null ? `; the line held was typically their #${s.medianRank}` : ""}`;
  });
}
