import type { Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";

/**
 * Real, computed trip metrics beyond the original scoring dimensions — the
 * "widen what the model can learn about" pass. Every field here is derived
 * from data the bid pack actually prints (report/block times, printed
 * layover durations, the EQP column), or from real arithmetic on that data
 * (a per-leg UTC offset from GMT vs local, not a guess). Nothing here is
 * inferred from anything the bid pack doesn't say — categories from the
 * original taxonomy sketch with no real data source in this app (hotel
 * walkability, crew-pairing history, seniority/award odds, weather,
 * holiday-calendar placement) are deliberately left out rather than faked;
 * see the comment on `MissingCategories` at the bottom.
 *
 * `TripLeg.depTimeGmt`/`arrTimeGmt`/`equipment` are only populated on trips
 * parsed after these fields were added — a trip loaded from an older
 * localStorage snapshot has them `undefined` at runtime despite the type
 * saying otherwise, so every reader here treats them as optional.
 */

function hhmmToMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

/**
 * Real UTC offset in minutes at the moment of this clock reading, derived
 * from the pairing schedule's own "GMT(LOCAL)" pair — not looked up from an
 * airport database, so it's exactly right for that specific reading (DST
 * included) rather than a generic per-airport constant. Confirmed against
 * the parser's own worked example: OAK "1940(1240)" -> 760-1180 = -420 =
 * PDT's UTC-7. Returns null when the reading predates this field existing.
 */
function utcOffsetMinutes(localHHMM: string | undefined, gmtHHMM: string | undefined): number | null {
  if (!localHHMM || !gmtHHMM) return null;
  let diff = hhmmToMinutes(localHHMM) - hhmmToMinutes(gmtHHMM);
  while (diff > 720) diff -= 1440;
  while (diff <= -720) diff += 1440;
  return diff;
}

function isRedEyeLocal(hhmm: string): boolean {
  const m = hhmmToMinutes(hhmm);
  return m >= 0 && m < 5 * 60;
}

/** "Back of the clock" — departing during the circadian low, roughly 02:00-06:00 local, whether or not it also counts as a red-eye by the stricter midnight-5am window above. */
function isBackOfClockLocal(hhmm: string): boolean {
  const m = hhmmToMinutes(hhmm);
  return m >= 2 * 60 && m < 6 * 60;
}

interface MinMaxAvg {
  min: number;
  max: number;
  avg: number;
}

function minMaxAvg(values: number[]): MinMaxAvg | null {
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

const HOTEL_CHAINS = [
  "RITZ-CARLTON",
  "JW MARRIOTT",
  "GRAND HYATT",
  "PARK HYATT",
  "ST REGIS",
  "W HOTEL",
  "FOUR SEASONS",
  "INTERCONTINENTAL",
  "SHERATON",
  "MARRIOTT",
  "HYATT",
  "HILTON",
  "WESTIN",
  "RENAISSANCE",
  "DOUBLETREE",
  "HOLIDAY INN",
  "COURTYARD",
  "FAIRMONT",
  "SWISSOTEL",
  "CROWNE PLAZA",
  "HAMPTON INN",
  "AMARI",
];

/** Guesses a hotel's chain from its printed name via substring match against known chain names — real string matching against real printed text, not invented, but not exhaustive (an unrecognized property returns null rather than a wrong guess). */
function guessHotelChain(hotelName: string | null): string | null {
  if (!hotelName) return null;
  const upper = hotelName.toUpperCase();
  return HOTEL_CHAINS.find((chain) => upper.includes(chain)) ?? null;
}

export type LayoverBucket = "short" | "standard" | "extended";

/** Threshold-shaped, per Section 4P — "long enough to feel like a mini vacation" is a real category boundary a pilot would recognize, not a smooth curve. */
function layoverBucket(hours: number): LayoverBucket {
  if (hours < 12) return "short";
  if (hours <= 24) return "standard";
  return "extended";
}

/** The same gap the trip-timeline chart draws as "Ground" — report/hotel-pickup time before a duty's first departure — recomputed here as a plain number rather than a render-ready segment. */
function groundGapHours(duty: TripDutyPeriod): number | null {
  const firstLeg = duty.legs[0];
  if (!firstLeg) return null;
  const gap = firstLeg.startMinutes - duty.startMinutes;
  return gap > 0 ? gap / 60 : 0;
}

export interface TripAnalytics {
  // ---- A. Report time & circadian dynamics ----
  redEyeDepartures: number;
  redEyeArrivals: number;
  backOfClockDepartures: number;
  /** Distinct first-leg-of-duty local departure times, rounded to the hour — a trip that reports at a different hour every duty is a shifting-body-clock trip, even if no single duty is a "red-eye." */
  distinctReportHours: number;
  /** Net signed timezone minutes crossed, legwise (positive = eastbound overall, negative = westbound) — real, from each leg's own GMT/local pair, not a lookup table. Null when GMT data isn't available (pre-migration trip). */
  netTimezoneMinutes: number | null;
  /** Sum of absolute per-leg timezone deltas — total zone-crossing "distance," independent of direction. */
  totalTimezoneCrossingMinutes: number | null;
  maxSingleLegTimezoneDeltaMinutes: number | null;

  // ---- B. Duty day & trip structure ----
  dutyPeriodCount: number;
  dutyLengthHours: MinMaxAvg | null;
  legsPerDuty: MinMaxAvg | null;
  reportToReleaseHours: number | null;
  /** >1 means the trip's total duty time meaningfully exceeds its flying time — a schedule padded with ground time/connections rather than an efficient one. Null when block data is incomplete. */
  dutyToBlockRatio: number | null;

  // ---- C. Flying workload & aircraft ----
  totalBlockHours: number | null;
  deadheadBlockHours: number | null;
  deadheadRatio: number | null;
  /** Distinct company fleet codes actually flown (excludes "JET", which marks an interline/generic airframe the pilot isn't operating). */
  distinctAircraftTypes: string[];
  totalLegs: number;
  longestLegHours: number | null;
  shortestLegHours: number | null;
  avgTurnTimeMinutes: number | null;
  maxTurnTimeMinutes: number | null;

  // ---- D. Rest, sleep & recovery ----
  shortRestOvernights: number;
  longRestOvernights: number;
  avgLayoverHours: number | null;
  /** Layover hours minus the real "Ground" gap that follows it (hotel pickup through block-off) — a closer estimate of actual usable rest than the raw printed layover duration. */
  avgSleepOpportunityHours: number | null;
  backToBackRedEyeDuties: number;

  // ---- E. Hotel & layover environment ----
  hotelChains: (string | null)[];
  layoverBuckets: Record<LayoverBucket, number>;

  // ---- I. Financial & pay efficiency ----
  /** Credit hours earned per hour away from base — a trip that pays well per hour of actual time gone, independent of how long the trip is. */
  creditPerTafbHour: number | null;
}

/**
 * Categories from the original brainstorm with no honest data source in this
 * app: hotel walkability/area safety, crew-pairing/instructor history,
 * seniority-weighted award probability, route weather/irregular-ops
 * history, per diem or dollar pay figures, and anything calendar-date-
 * dependent (holiday trips, days-off clustering, consecutive-day streaks
 * across a line) — the line-grid parser verifies which pairings belong to a
 * line by matching aggregate credit/block/landings totals, not by tracking
 * each pairing's calendar position, so "which day of the month is this"
 * isn't reliable data to build on without a separate, riskier parsing
 * project. These are left out rather than approximated.
 */
export type MissingCategories = never;

/** Cheap standalone check for filtering — true if any leg departs or arrives in the 00:00-05:00 local red-eye window. Reuses the exact same window `computeTripAnalytics` counts, without computing everything else about the trip just to answer one boolean. */
export function hasRedEyeLeg(trip: Trip): boolean {
  return trip.schedule
    .flatMap((d) => d.legs)
    .some((l) => isRedEyeLocal(l.depTimeLocal) || isRedEyeLocal(l.arrTimeLocal));
}

export function computeTripAnalytics(trip: Trip): TripAnalytics {
  const duties = trip.schedule;
  const allLegs: TripLeg[] = duties.flatMap((d) => d.legs);

  const redEyeDepartures = allLegs.filter((l) => isRedEyeLocal(l.depTimeLocal)).length;
  const redEyeArrivals = allLegs.filter((l) => isRedEyeLocal(l.arrTimeLocal)).length;
  const backOfClockDepartures = allLegs.filter((l) => isBackOfClockLocal(l.depTimeLocal)).length;

  const reportHours = new Set(
    duties.map((d) => d.legs[0]?.depTimeLocal).filter((t): t is string => !!t).map((t) => t.slice(0, 2))
  );

  const timezoneDeltas = allLegs
    .map((l) => {
      const depOffset = utcOffsetMinutes(l.depTimeLocal, l.depTimeGmt);
      const arrOffset = utcOffsetMinutes(l.arrTimeLocal, l.arrTimeGmt);
      if (depOffset === null || arrOffset === null) return null;
      return arrOffset - depOffset;
    })
    .filter((d): d is number => d !== null);
  const hasTimezoneData = timezoneDeltas.length === allLegs.length && allLegs.length > 0;

  const dutyLengths = duties
    .map((d) => {
      const lastLeg = d.legs[d.legs.length - 1];
      if (!lastLeg) return null;
      const end = d.layover ? d.layover.startMinutes : lastLeg.endMinutes;
      return (end - d.startMinutes) / 60;
    })
    .filter((h): h is number => h !== null && h >= 0);

  const legsPerDuty = duties.map((d) => d.legs.length);

  const lastDuty = duties[duties.length - 1];
  const lastLegOverall = lastDuty?.legs[lastDuty.legs.length - 1];
  const reportToReleaseHours =
    duties.length > 0 && lastLegOverall ? (lastLegOverall.endMinutes - duties[0].startMinutes) / 60 : null;

  const blockValues = allLegs.map((l) => l.blockHours).filter((b): b is number => b !== null);
  const totalBlockHours = blockValues.length > 0 ? blockValues.reduce((a, b) => a + b, 0) : null;
  const deadheadBlockValues = allLegs
    .filter((l) => l.isDeadhead)
    .map((l) => l.blockHours)
    .filter((b): b is number => b !== null);
  const deadheadBlockHours = deadheadBlockValues.length > 0 ? deadheadBlockValues.reduce((a, b) => a + b, 0) : null;

  const distinctAircraftTypes = Array.from(
    new Set(
      allLegs
        .filter((l) => !l.isDeadhead && l.equipment && l.equipment !== "JET")
        .map((l) => l.equipment)
    )
  );

  const turnTimes: number[] = [];
  for (const duty of duties) {
    for (let i = 0; i < duty.legs.length - 1; i++) {
      const gap = duty.legs[i + 1].startMinutes - duty.legs[i].endMinutes;
      if (gap > 0) turnTimes.push(gap);
    }
  }

  const layovers = duties.map((d) => d.layover).filter((l): l is NonNullable<typeof l> => !!l);
  const sleepOpportunities = duties
    .map((d, i) => {
      if (!d.layover) return null;
      const nextDuty = duties[i + 1];
      if (!nextDuty) return d.layover.hours;
      const ground = groundGapHours(nextDuty);
      return ground === null ? d.layover.hours : Math.max(0, d.layover.hours - ground);
    })
    .filter((h): h is number => h !== null);

  let backToBackRedEyeDuties = 0;
  for (let i = 0; i < duties.length - 1; i++) {
    const thisHasRedEye = duties[i].legs.some((l) => isRedEyeLocal(l.depTimeLocal) || isRedEyeLocal(l.arrTimeLocal));
    const nextHasRedEye = duties[i + 1].legs.some(
      (l) => isRedEyeLocal(l.depTimeLocal) || isRedEyeLocal(l.arrTimeLocal)
    );
    if (thisHasRedEye && nextHasRedEye) backToBackRedEyeDuties++;
  }

  const buckets: Record<LayoverBucket, number> = { short: 0, standard: 0, extended: 0 };
  for (const l of layovers) buckets[layoverBucket(l.hours)]++;

  return {
    redEyeDepartures,
    redEyeArrivals,
    backOfClockDepartures,
    distinctReportHours: reportHours.size,
    netTimezoneMinutes: hasTimezoneData ? timezoneDeltas.reduce((a, b) => a + b, 0) : null,
    totalTimezoneCrossingMinutes: hasTimezoneData
      ? timezoneDeltas.reduce((a, b) => a + Math.abs(b), 0)
      : null,
    maxSingleLegTimezoneDeltaMinutes: hasTimezoneData
      ? Math.max(...timezoneDeltas.map((d) => Math.abs(d)))
      : null,

    dutyPeriodCount: duties.length,
    dutyLengthHours: minMaxAvg(dutyLengths),
    legsPerDuty: minMaxAvg(legsPerDuty),
    reportToReleaseHours,
    dutyToBlockRatio:
      totalBlockHours && totalBlockHours > 0 && dutyLengths.length > 0
        ? dutyLengths.reduce((a, b) => a + b, 0) / totalBlockHours
        : null,

    totalBlockHours,
    deadheadBlockHours,
    deadheadRatio: totalBlockHours && totalBlockHours > 0 ? (deadheadBlockHours ?? 0) / totalBlockHours : null,
    distinctAircraftTypes,
    totalLegs: allLegs.length,
    longestLegHours: blockValues.length > 0 ? Math.max(...blockValues) : null,
    shortestLegHours: blockValues.length > 0 ? Math.min(...blockValues) : null,
    avgTurnTimeMinutes: turnTimes.length > 0 ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length : null,
    maxTurnTimeMinutes: turnTimes.length > 0 ? Math.max(...turnTimes) : null,

    shortRestOvernights: layovers.filter((l) => l.hours < 12).length,
    longRestOvernights: layovers.filter((l) => l.hours > 24).length,
    avgLayoverHours: layovers.length > 0 ? layovers.reduce((a, b) => a + b.hours, 0) / layovers.length : null,
    avgSleepOpportunityHours:
      sleepOpportunities.length > 0 ? sleepOpportunities.reduce((a, b) => a + b, 0) / sleepOpportunities.length : null,
    backToBackRedEyeDuties,

    hotelChains: trip.layoverDetails.map((d) => guessHotelChain(d.hotelName)),
    layoverBuckets: buckets,

    creditPerTafbHour: trip.tafbHours > 0 ? trip.creditHours / trip.tafbHours : null,
  };
}
