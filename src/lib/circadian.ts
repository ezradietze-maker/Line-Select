import { tripBodyClockScore } from "@/lib/body-clock-score";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * The body clock, line-wide: the home base's real UTC offset (the clock a pilot's body starts every trip on), and
 * whether two rough trips sit too close together to recover between. Each trip's and line's own body-clock score —
 * night work, nights in a row, early reports, time awake, layover sleep, day/night flips, time zones and recovery, each
 * from the research — is `lib/body-clock-score.ts`.
 */

function hhmmToMinutes(hhmm: string): number {
  return parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(2, 4), 10);
}

/** The real UTC offset implied by one leg's own printed local + GMT time for the same instant — not looked up from a table, derived straight from the bid pack. */
function utcOffsetMinutes(localHHMM: string, gmtHHMM: string): number {
  let diff = hhmmToMinutes(localHHMM) - hhmmToMinutes(gmtHHMM);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

/**
 * Derived once per bid pack from the first real leg departing home base —
 * every trip starts and ends there, so any trip with a verified schedule
 * gives us the base's real UTC offset for free, no hardcoded airport table.
 */
export function computeHomeBaseOffsetMinutes(bidPack: BidPack): number | null {
  for (const line of bidPack.lines) {
    for (const trip of line.trips) {
      const firstLeg = trip.schedule[0]?.legs[0];
      if (firstLeg && firstLeg.depAirport === bidPack.base) {
        return utcOffsetMinutes(firstLeg.depTimeLocal, firstLeg.depTimeGmt);
      }
    }
  }
  return null;
}

/** How many real days off a line needs between two trips to count as genuine recovery, not just a token gap — deliberately generous (this is about avoiding *compounding* disruption across trips). */
const MIN_REAL_RECOVERY_DAYS = 3;
/** A trip at or under this body-clock score is a rough one for compounding purposes — the harder end of the range. */
const DISRUPTIVE_SCORE = 35;

export interface CumulativeCircadianAssessment {
  /** The smallest real gap (in days off) between any two of this line's trips — null only when the line has fewer than two trips. */
  tightestRecoveryGapDays: number | null;
  /** True when two meaningfully disruptive trips sit closer together than a real recovery window — the specific pattern a per-trip-only view can't see. */
  hasCompoundingRisk: boolean;
  summary: string;
}

/**
 * Whether a line's trips into this cumulative check are worth trusting at
 * all — real calendar placement only (`Trip.startDayIndex` populated for
 * every trip, which requires `BidPack.bidPeriodStart` to exist too). This is
 * exactly the same calendar-position honesty boundary `trip-analytics.ts`'s
 * `MissingCategories` doc comment already draws for this whole app: the
 * line-grid parser confirms which pairings belong to a line by matching
 * aggregate totals, not by verifying each pairing's calendar day — so
 * approximating a recovery gap from trip *order* alone on a line without
 * confirmed placement would silently state a number that was never
 * verified. When it's not real, this returns null rather than guess.
 */
export function hasRealTripPlacement(trips: Trip[], bidPeriodStart: string | null): boolean {
  return bidPeriodStart !== null && trips.every((t) => t.startDayIndex !== null);
}

/**
 * How much real recovery separates this line's own trips, and whether two genuinely rough trips (body-clock score at or
 * under `DISRUPTIVE_SCORE`) sit close enough together to compound. Gated on `hasRealTripPlacement`: for a line whose
 * exact calendar placement couldn't be confirmed, this returns null rather than approximate a recovery window from trip
 * order alone.
 */
export function computeCumulativeCircadianAssessment(
  trips: Trip[],
  homeBaseOffsetMinutes: number | null,
  bidPeriodStart: string | null,
  consecutiveTolerance?: number | null
): CumulativeCircadianAssessment | null {
  if (!hasRealTripPlacement(trips, bidPeriodStart) || homeBaseOffsetMinutes === null) return null;
  if (trips.length < 2) return { tightestRecoveryGapDays: null, hasCompoundingRisk: false, summary: "Only one trip this month — nothing to compound." };

  const sorted = [...trips].sort((a, b) => a.startDayIndex! - b.startDayIndex!);
  const scores = sorted.map((t) => tripBodyClockScore(t, homeBaseOffsetMinutes, consecutiveTolerance ?? null)?.score ?? null);

  let tightestGap: number | null = null;
  let hasCompoundingRisk = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const gap = next.startDayIndex! - (current.startDayIndex! + current.days);
    if (tightestGap === null || gap < tightestGap) tightestGap = gap;
    const a = scores[i];
    const b = scores[i + 1];
    if (a !== null && b !== null && a <= DISRUPTIVE_SCORE && b <= DISRUPTIVE_SCORE && gap < MIN_REAL_RECOVERY_DAYS) hasCompoundingRisk = true;
  }

  const summary = hasCompoundingRisk
    ? `Two rough trips back to back with only ${tightestGap} real day${tightestGap === 1 ? "" : "s"} off between them.`
    : tightestGap !== null
      ? `At least ${tightestGap} real day${tightestGap === 1 ? "" : "s"} off between every trip this month.`
      : "No real gaps to assess.";

  return { tightestRecoveryGapDays: tightestGap, hasCompoundingRisk, summary };
}
