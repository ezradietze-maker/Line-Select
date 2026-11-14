import { monthLine, tripCarryOver } from "@/lib/bid-month";
import { monthIndex } from "@/lib/bid-timeline";
import { flownUnderInternationalRules, operatedBlockHours, tripSpans } from "@/lib/phase-in";
import { tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import type { AwardHistorySubmission } from "@/types/award-history";
import type { BidPack, Line } from "@/types/bidpack";
import type { CarriedTrip, LoggedMonth, MonthFeel } from "@/types/logbook";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

/**
 * The pilot's logbook: one entry a month — the award, and the line's shape as it was (the pack is replaced next month,
 * so the entry keeps its own copy) — and what the months add up to. Kept in the profile, so it travels with the
 * pilot's account.
 */

/** The held line's trips still flying when the month ends, with real times — all next month's carry-in needs of them. */
function carriedOut(line: Line, pack: Pick<BidPack, "base" | "bidPeriodStart" | "bidPeriodDays">): CarriedTrip[] {
  return line.trips.flatMap((trip) => {
    const report = tripReportUtc(pack, trip);
    if (report === null || !tripCarryOver(trip, pack)) return [];
    const iso = (ms: number) => new Date(ms).toISOString();
    const release = report + tripReleaseHours(trip) * 3_600_000;
    return [
      {
        label: trip.pairingNumber ? `Trip ${trip.pairingNumber}` : "Your carry-in trip",
        report: iso(report),
        release: iso(release),
        international: flownUnderInternationalRules(trip),
        creditHours: trip.creditHours,
        // Each day of a run of day trips ends at its own release, not the run's (`tripSpans`).
        duties: tripSpans(trip, report).map((d) => ({ start: iso(d.start), end: iso(d.end) })),
        lastDutyBlockHours: operatedBlockHours(trip.schedule[trip.schedule.length - 1]),
      },
    ];
  });
}

/** A month's entry from the pack it was bid in: the line held (its own month's numbers), or reserve or something else. */
export function loggedMonthFrom(
  pack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month" | "bidPeriodStart" | "bidPeriodDays">,
  outcome: LoggedMonth["outcome"],
  line: Line | null,
  extras: { rankedAt?: number | null; seniority?: SeniorityInput | null; now?: Date; id?: string } = {}
): LoggedMonth {
  const held = outcome === "line" && line ? monthLine(line, pack) : null;
  return {
    id: extras.id ?? `${pack.base}-${pack.aircraft}-${pack.seat}-${pack.month}`,
    bidPackId: pack.id,
    base: pack.base,
    aircraft: pack.aircraft,
    seat: pack.seat,
    month: pack.month,
    outcome,
    lineNumber: held?.lineNumber ?? null,
    creditHours: held?.totalCreditHours ?? null,
    daysOff: held?.daysOff ?? null,
    tafbHours: held?.totalTafbHours ?? null,
    tripCount: held ? held.trips.length : null,
    layoverCities: held ? held.trips.flatMap((t) => t.schedule.flatMap((d) => (d.layover ? [d.layover.city] : []))) : [],
    ...(outcome === "line" && line && carriedOut(line, pack).length ? { carryOut: carriedOut(line, pack) } : {}),
    rankedAt: held ? (extras.rankedAt ?? null) : null,
    seniorityRank: extras.seniority?.rank ?? null,
    seniorityTotalPilots: extras.seniority?.totalPilots ?? null,
    loggedAt: (extras.now ?? new Date()).toISOString(),
  };
}

/**
 * Oldest month first: by the bid month itself, then when logged. By when logged alone, a month caught up on after the
 * next one went above it, and the seniority over time ran out of order.
 */
function byMonth(a: LoggedMonth, b: LoggedMonth): number {
  const [x, y] = [monthIndex(a.month), monthIndex(b.month)];
  return (x !== null && y !== null ? x - y : 0) || a.loggedAt.localeCompare(b.loggedAt);
}

/** The months newest first, as the logbook keeps and shows them. */
export const newestMonthFirst = (entries: LoggedMonth[]): LoggedMonth[] => [...entries].sort((a, b) => byMonth(b, a));

/** The profile with this month logged — replacing an earlier entry for the same month. Newest month first. */
export function withLoggedMonth(profile: PreferenceProfile, entry: LoggedMonth): PreferenceProfile {
  const rest = (profile.logbook ?? []).filter((m) => m.id !== entry.id);
  return { ...profile, logbook: newestMonthFirst([entry, ...rest]) };
}

export function withoutLoggedMonth(profile: PreferenceProfile, id: string): PreferenceProfile {
  return { ...profile, logbook: (profile.logbook ?? []).filter((m) => m.id !== id) };
}

export function withEntry(profile: PreferenceProfile, id: string, change: Partial<LoggedMonth>): PreferenceProfile {
  return { ...profile, logbook: (profile.logbook ?? []).map((m) => (m.id === id ? { ...m, ...change } : m)) };
}

/**
 * The report for a month already shared, carrying how it flew — sent again when the pilot checks in, so the
 * real-outcome score learns from it (`lib/learning/outcome-score.ts`). Null for a month that was never shared or
 * lacks the seniority every report needs.
 */
export function checkInShare(entry: LoggedMonth, model: { brainVersion?: number; notesUsed?: boolean } | null | undefined): AwardHistorySubmission | null {
  if (!entry.sharedAt || !entry.checkIn || entry.seniorityRank == null || entry.seniorityTotalPilots == null) return null;
  const whole = (x: number | null | undefined) => (typeof x === "number" ? Math.round(x) : null);
  return {
    base: entry.base,
    aircraft: entry.aircraft,
    seat: entry.seat,
    month: entry.month,
    seniorityRank: entry.seniorityRank,
    seniorityTotalPilots: entry.seniorityTotalPilots,
    outcome: entry.outcome,
    lineNumber: entry.lineNumber ?? null,
    daysOff: whole(entry.daysOff),
    totalCreditHours: whole(entry.creditHours),
    totalTafbHours: whole(entry.tafbHours),
    awardedChoice: entry.rankedAt ?? null,
    holderShown: entry.holderShown === true,
    monthFeel: entry.checkIn.feel,
    brainVersion: model?.brainVersion ?? null,
    notesUsed: model?.notesUsed ?? null,
  };
}

/** The profile with a month's share taken back, or with no id, every share: the months stay logged. */
export function withoutShares(profile: PreferenceProfile, id?: string): PreferenceProfile {
  return {
    ...profile,
    logbook: (profile.logbook ?? []).map((m) => {
      if (id !== undefined && m.id !== id) return m;
      const rest = { ...m };
      delete rest.sharedAt;
      delete rest.holderShown;
      return rest;
    }),
  };
}

/** How a month flew, said after it. */
export function withCheckIn(profile: PreferenceProfile, id: string, feel: MonthFeel, words: { bestTrip?: string; worstTrip?: string; note?: string } = {}, now: Date = new Date()): PreferenceProfile {
  const clean = (s?: string) => (s?.trim() ? s.trim() : undefined);
  return withEntry(profile, id, { checkIn: { feel, bestTrip: clean(words.bestTrip), worstTrip: clean(words.worstTrip), note: clean(words.note), at: now.toISOString() } });
}

export interface LogbookStats {
  months: number;
  lineMonths: number;
  avgCreditHours: number | null;
  avgDaysOff: number | null;
  /** Layovers per city across every logged line, most first. */
  cities: { code: string; layovers: number }[];
  /** How often the line held was one of the pilot's own top 5. */
  topFiveShare: number | null;
  /** Seniority as a percentile (0 = most senior) month by month, oldest first. */
  seniority: { month: string; percentile: number }[];
}

export function logbookStats(entries: LoggedMonth[]): LogbookStats {
  const lines = entries.filter((m) => m.outcome === "line");
  const avg = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const cities = new Map<string, number>();
  for (const m of lines) for (const c of m.layoverCities ?? []) cities.set(c, (cities.get(c) ?? 0) + 1);
  const ranked = lines.filter((m) => typeof m.rankedAt === "number");
  return {
    months: entries.length,
    lineMonths: lines.length,
    avgCreditHours: avg(lines.map((m) => m.creditHours)),
    avgDaysOff: avg(lines.map((m) => m.daysOff)),
    cities: [...cities].map(([code, layovers]) => ({ code, layovers })).sort((a, b) => b.layovers - a.layovers || a.code.localeCompare(b.code)),
    topFiveShare: ranked.length ? ranked.filter((m) => (m.rankedAt as number) <= 5).length / ranked.length : null,
    seniority: [...entries]
      .filter((m) => m.seniorityRank && m.seniorityTotalPilots)
      .sort(byMonth)
      .map((m) => ({ month: m.month, percentile: (m.seniorityRank as number) / (m.seniorityTotalPilots as number) })),
  };
}
