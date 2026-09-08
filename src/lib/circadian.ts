import type { BidPack, Trip } from "@/types/bidpack";

/**
 * Per-trip circadian disruption score — a separate, health-facing rating
 * from the 0-100 preference match score. Grounded in three established
 * pieces of aviation fatigue science, applied to the bid pack's own printed
 * times (not estimated):
 *
 * 1. Time-zone shift direction asymmetry. The human circadian clock runs
 *    slightly longer than 24 hours on its own (~24.2h, Czeisler et al.),
 *    which makes it physiologically easier to phase-DELAY (a westward shift
 *    — your day gets longer) than to phase-ADVANCE (an eastward shift —
 *    your day gets shorter). Real-world recovery estimates commonly cited
 *    in aviation fatigue guidance run around 1 day per time zone westward
 *    versus roughly 1.5 days per time zone eastward. This is why, for
 *    example, flying home east across the Pacific typically hits harder
 *    than flying out west to Asia, even though both cross the same zones.
 * 2. The Window of Circadian Low (WOCL) — the 02:00-05:59 stretch (ICAO/
 *    EASA fatigue risk management standard) when core body temperature and
 *    alertness bottom out. Any duty period whose report time falls in this
 *    window is a real, named fatigue flag in actual FRMS practice, not
 *    something specific to this app.
 * 3. Minimum rest / sleep opportunity. US FAA Part 117 sets 10 consecutive
 *    hours as the rest-period floor specifically because it's what's
 *    needed to realistically get 8 hours of sleep once hotel transport,
 *    meals, and wind-down are accounted for. A layover under that isn't
 *    "less recovery" in the abstract, it's under the regulatory floor for
 *    a full sleep opportunity.
 *
 * What this deliberately does NOT model: full circadian phase adaptation
 * over a multi-day trip (that's what dedicated fatigue-modeling tools like
 * SAFTE-FAST or the Boeing Alertness Model do, with proprietary curve-fits).
 * This uses each duty period's own printed local time as the "am I awake
 * when my body doesn't expect to be" signal, which is the right proxy for
 * WOCL exposure (light/dark and environment are real local-time-driven cues
 * regardless of how adapted the body clock is yet) — it's a principled
 * simplification, not a claim of clinical precision.
 */

export interface CircadianAssessment {
  stars: 1 | 2 | 3 | 4 | 5;
  /** Signed hours vs. home base, using the shorter way around the globe. Positive = eastward/phase-advance (harder), negative = westward/phase-delay (easier). */
  timezoneShiftHours: number;
  /** Duty periods whose report time falls in the 02:00-05:59 Window of Circadian Low. */
  wocEncroachments: number;
  /** Layovers under the FAA Part 117 10-hour rest floor. */
  shortRestCount: number;
  /** One-line, plain-English reason for the score, naming the biggest contributor. */
  summary: string;
}

const WOCL_START_MIN = 2 * 60;
const WOCL_END_MIN = 6 * 60;
const SHORT_REST_FLOOR_HOURS = 10;
const SEVERE_REST_FLOOR_HOURS = 8;
/** Aviation fatigue guidance commonly puts eastward (phase-advance) recovery at roughly 1.5x the westward (phase-delay) rate. */
const EASTWARD_MULTIPLIER = 1.5;

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

/** Signed shift vs. home base, normalized to the shorter way around the globe: positive = eastward/phase-advance, negative = westward/phase-delay. */
function signedShiftHours(homeOffsetMin: number, destOffsetMin: number): number {
  let diff = destOffsetMin - homeOffsetMin;
  diff = ((diff + 720) % 1440 + 1440) % 1440 - 720;
  return diff / 60;
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

function shiftPenalty(effectiveShiftHours: number): number {
  if (effectiveShiftHours < 2) return 0;
  if (effectiveShiftHours < 4) return 1;
  if (effectiveShiftHours < 7) return 2;
  if (effectiveShiftHours < 10) return 3;
  return 4;
}

function starsFromPenalty(penalty: number): 1 | 2 | 3 | 4 | 5 {
  if (penalty <= 1) return 5;
  if (penalty <= 3) return 4;
  if (penalty <= 6) return 3;
  if (penalty <= 9) return 2;
  return 1;
}

function formatShift(hours: number): string {
  const rounded = Math.round(Math.abs(hours));
  const direction = hours > 0 ? "east" : "west";
  return `${rounded}h ${direction === "east" ? "eastward" : "westward"}`;
}

/**
 * The longest run of CONSECUTIVE duty periods within one trip whose report
 * time falls in the WOCL — distinct from a bare count, since two isolated
 * early reports on a 4-day trip are a very different experience from two
 * back-to-back ones. Order is exact here (a trip's own duty sequence is
 * known outright, unlike calendar position ACROSS trips — see
 * `MissingCategories` in `trip-analytics.ts` for why that distinction
 * matters and where this app draws the line on what it will and won't
 * infer).
 */
function longestConsecutiveWocStreak(trip: Trip): number {
  let longest = 0;
  let current = 0;
  for (const duty of trip.schedule) {
    const reportMin = hhmmToMinutes(duty.reportTimeLocal);
    if (reportMin >= WOCL_START_MIN && reportMin < WOCL_END_MIN) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * `Math.min(wocEncroachments, 3)` (unchanged) when no pilot tolerance is
 * known — the same generic default this scoring has always used. Once a
 * pilot has actually stated how many consecutive early/late reports they
 * can handle before it wears on them (the report-time-circadian interview
 * topic, captured as `explicitTargets.circadianTolerance`), the penalty is
 * personalized instead: a report streak within their own stated tolerance
 * costs a mild, capped amount (matching how forgiving the generic default
 * already was), while a streak that exceeds what they themselves said they
 * can handle costs sharply more per report beyond it — this pilot told the
 * interview exactly where that line is, so the model should trust it rather
 * than falling back to a one-size-fits-all cap.
 */
function personalizedWocPenalty(
  wocEncroachments: number,
  streak: number,
  consecutiveTolerance: number | null | undefined
): number {
  if (consecutiveTolerance === null || consecutiveTolerance === undefined) {
    return Math.min(wocEncroachments, 3);
  }
  if (wocEncroachments === 0) return 0;
  const withinTolerance = Math.min(streak, consecutiveTolerance);
  const overTolerance = Math.max(0, streak - consecutiveTolerance);
  return Math.min(3, withinTolerance * 0.5) + overTolerance * 2;
}

/** Null when the trip has no verified schedule (estimated line, or reconciliation failed) or the bid pack's home-base offset couldn't be derived — same honesty policy as the rest of the app: no real data in, no score out. */
export function computeCircadianAssessment(
  trip: Trip,
  homeBaseOffsetMinutes: number | null,
  /** This pilot's own stated ceiling on consecutive WOCL-window reports (`explicitTargets.circadianTolerance`), if the interview ever asked. Absent/null keeps the exact generic behavior this function always had. */
  consecutiveTolerance?: number | null
): CircadianAssessment | null {
  if (trip.schedule.length === 0 || homeBaseOffsetMinutes === null) return null;

  let worstShift = 0; // signed hours, keep the one with the largest magnitude
  for (const duty of trip.schedule) {
    if (!duty.layover) continue;
    const arrivingLeg = duty.legs[duty.legs.length - 1];
    if (!arrivingLeg) continue;
    const destOffset = utcOffsetMinutes(arrivingLeg.arrTimeLocal, arrivingLeg.arrTimeGmt);
    const shift = signedShiftHours(homeBaseOffsetMinutes, destOffset);
    if (Math.abs(shift) > Math.abs(worstShift)) worstShift = shift;
  }

  const effectiveShift = Math.abs(worstShift) * (worstShift > 0 ? EASTWARD_MULTIPLIER : 1);
  const tzPenalty = shiftPenalty(effectiveShift);

  let wocEncroachments = 0;
  for (const duty of trip.schedule) {
    const reportMin = hhmmToMinutes(duty.reportTimeLocal);
    if (reportMin >= WOCL_START_MIN && reportMin < WOCL_END_MIN) wocEncroachments++;
  }
  const wocStreak = longestConsecutiveWocStreak(trip);
  const wocPenalty = personalizedWocPenalty(wocEncroachments, wocStreak, consecutiveTolerance);

  let shortRestCount = 0;
  let restPenalty = 0;
  for (const duty of trip.schedule) {
    if (!duty.layover) continue;
    if (duty.layover.hours < SEVERE_REST_FLOOR_HOURS) {
      shortRestCount++;
      restPenalty += 2;
    } else if (duty.layover.hours < SHORT_REST_FLOOR_HOURS) {
      shortRestCount++;
      restPenalty += 1;
    }
  }

  const totalPenalty = tzPenalty + wocPenalty + restPenalty;
  const stars = starsFromPenalty(totalPenalty);

  let summary: string;
  const exceedsPersonalTolerance =
    consecutiveTolerance !== null && consecutiveTolerance !== undefined && wocStreak > consecutiveTolerance;
  if (totalPenalty === 0) {
    summary = "No real circadian red flags — stays close to home-base time with real rest between duty periods.";
  } else if (tzPenalty >= wocPenalty && tzPenalty >= restPenalty) {
    summary = `Biggest factor: a ${formatShift(worstShift)} time-zone shift${
      worstShift > 0 ? " — the harder phase-advance direction to adapt to" : ""
    }.`;
  } else if (wocPenalty >= restPenalty) {
    summary = exceedsPersonalTolerance
      ? `Biggest factor: ${wocStreak} consecutive report times inside the 2-6am window — beyond the ${consecutiveTolerance} in a row you said you can handle.`
      : `Biggest factor: ${wocEncroachments} report time${wocEncroachments > 1 ? "s" : ""} inside the 2-6am window when the body's alertness is naturally lowest.`;
  } else {
    summary = `Biggest factor: ${shortRestCount} layover${shortRestCount > 1 ? "s" : ""} under the 10-hour rest floor needed for a real 8 hours of sleep.`;
  }

  return {
    stars,
    timezoneShiftHours: Math.round(worstShift * 10) / 10,
    wocEncroachments,
    shortRestCount,
    summary,
  };
}

/** How many real days off a line needs between two trips to count as genuine recovery, not just a token gap — deliberately generous (this is about avoiding *compounding* disruption, not the ordinary short-rest-overnight check `SHORT_REST_FLOOR_HOURS` already covers within a single trip). */
const MIN_REAL_RECOVERY_DAYS = 3;
/** A per-trip star rating at or below this counts as "meaningfully disruptive" for compounding-risk purposes — the same bar `starsFromPenalty` already treats as a real problem (3 stars is "some issues," 2 and below is "rough"). */
const DISRUPTIVE_STAR_THRESHOLD = 2;

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
 * Cross-trip view `computeCircadianAssessment` deliberately doesn't attempt
 * (see that function's own doc comment on what it does NOT model) — how
 * much real recovery separates this line's own trips, and whether two
 * genuinely rough trips sit close enough together to compound. Gated on
 * `hasRealTripPlacement`: for the (common) case where a line's exact
 * calendar placement couldn't be confirmed, this returns null rather than
 * approximate a recovery window from trip order alone.
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
  const assessments = sorted.map((t) => computeCircadianAssessment(t, homeBaseOffsetMinutes, consecutiveTolerance));

  let tightestGap: number | null = null;
  let hasCompoundingRisk = false;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const gap = next.startDayIndex! - (current.startDayIndex! + current.days);
    if (tightestGap === null || gap < tightestGap) tightestGap = gap;

    const a = assessments[i];
    const b = assessments[i + 1];
    if (a && b && a.stars <= DISRUPTIVE_STAR_THRESHOLD && b.stars <= DISRUPTIVE_STAR_THRESHOLD && gap < MIN_REAL_RECOVERY_DAYS) {
      hasCompoundingRisk = true;
    }
  }

  const summary = hasCompoundingRisk
    ? `Two rough trips back to back with only ${tightestGap} real day${tightestGap === 1 ? "" : "s"} off between them.`
    : tightestGap !== null
      ? `At least ${tightestGap} real day${tightestGap === 1 ? "" : "s"} off between every trip this month.`
      : "No real gaps to assess.";

  return { tightestRecoveryGapDays: tightestGap, hasCompoundingRisk, summary };
}
