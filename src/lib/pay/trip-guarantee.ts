import { formatHoursValue } from "@/lib/interview-config";
import { dayTripsOf } from "@/lib/trip-anchor";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/**
 * Pay floors a FedEx pilot can read straight off the bid pack, with the contract section each comes from. These are the
 * guaranteed minimums — what a trip or a line is worth however the month actually flies — not a full pay computation, and
 * never an official number. The pack already prints each trip's scheduled credit (its guarantee under CBA 2026 4.F.1);
 * we add the trip rig that underlies it and the bid-line floor, so a pilot can see what they're protected to and draft a
 * claim when they're paid less. Confirm anything you rely on with your PSIT bid rep. See docs — none of this is submitted anywhere.
 */

/** CBA 2026 4.F.2.a: "Trip rig is 1 CH for each 3.75 hours of time away from base (TAFB)." */
export const TAFB_HOURS_PER_RIG_CH = 3.75;

/** CBA 2026 4.A.1: the minimum bid period guarantee, by the length of the bid period. */
export function minBidPeriodGuarantee(bidPeriodDays: number): { ch: number; section: string } | null {
  if (bidPeriodDays <= 28) return { ch: 68, section: "4.A.1.a" }; // 4-week
  if (bidPeriodDays <= 35) return { ch: 85, section: "4.A.1.b" }; // 5-week
  if (bidPeriodDays <= 42) return { ch: 102, section: "4.A.1.c" }; // 6-week
  return null;
}

/**
 * Credit to the whole minute, as the pack prints it and 4.F.2.a rounds rig. Hundredths of an hour are 0.6 minutes: a
 * 41:05 TAFB's rig read 10:58 for 10:57, and four 18:56 trips added to 75:43 for 75:44.
 */
const toMinute = (n: number) => Math.round(n * 60) / 60;

/**
 * CBA 2026 4.F.2.a: a trip's rig, in CH, from its time away from base, rounded to the nearest minute. From the TAFB the
 * pack prints, to the minute: kept in hundredths, 44:58 away read 44.97 and its rig 12:00, a minute over the 11:59 the
 * trip is credited.
 */
export function tripRig(tafbHours: number): number {
  return toMinute(toMinute(tafbHours) / TAFB_HOURS_PER_RIG_CH);
}

export interface TripPay {
  trip: Trip;
  /** The trip's scheduled credit as the pack prints it — its guarantee under CBA 2026 4.F.1. */
  guaranteeCH: number;
  /** CBA 2026 4.F.2.a trip rig from this trip's TAFB. Always ≤ the guarantee, which also counts block and duty. */
  rigCH: number;
  /** Credit earned per 24h away — how hard the trip's credit works for the time it costs. */
  creditPerDayAway: number | null;
}

export function tripPay(trip: Trip): TripPay {
  const guaranteeCH = toMinute(trip.creditHours);
  const rigCH = tripRig(trip.tafbHours);
  const daysAway = trip.tafbHours / 24;
  return { trip, guaranteeCH, rigCH, creditPerDayAway: daysAway > 0 ? toMinute(guaranteeCH / daysAway) : null };
}

export interface LinePay {
  trips: TripPay[];
  /**
   * CBA 2026 4.B: the sum of the trips' guarantees, "excluding that portion of the CH of a carryover trip allocated to the
   * next bid period" — the Bid Line Guarantee before the floor.
   */
  tripGuaranteeTotal: number;
  /** The share of a trip running past the period's end that the pack allocates to the next bid period (CBA 2026 4.G). */
  carryOverCH: number;
  /** CBA 2026 4.A.1: the floor the BLG can't fall below, and its section; null for an unusual bid-period length. */
  floor: { ch: number; section: string } | null;
  /** CBA 2026 4.B: the greater of the two — what the whole line guarantees this bid period. */
  blg: number;
  /** True when the floor, not the trips, set the BLG. */
  flooredUp: boolean;
}

/**
 * The pay a regular line guarantees this bid period, from its trips. A trip printed whole carries its full credit, so the
 * next period's share the line prints (4.G) comes off: counted in, a line ending on a trip over the period's end read
 * its next month's credit as this month's guarantee. A run of the same day trip is its days, each its own trip and
 * guarantee (`dayTripsOf`): kept whole, a pilot paid short on its second day was checked against all three days' credit.
 */
export function linePay(line: Line, pack: Pick<BidPack, "bidPeriodDays">): LinePay {
  const trips = line.trips.flatMap(dayTripsOf).map(tripPay);
  const carryOverCH = toMinute(Math.max(0, line.carryOverCreditHours ?? 0));
  const tripGuaranteeTotal = toMinute(Math.max(0, trips.reduce((a, t) => a + t.guaranteeCH, 0) - carryOverCH));
  const floor = minBidPeriodGuarantee(pack.bidPeriodDays);
  const blg = floor ? Math.max(tripGuaranteeTotal, floor.ch) : tripGuaranteeTotal;
  return { trips, tripGuaranteeTotal, carryOverCH, floor, blg: toMinute(blg), flooredUp: !!floor && floor.ch > tripGuaranteeTotal };
}

/**
 * What a pilot paid less than a trip's guarantee may claim: the shortfall, never negative (CBA 2026 4.F.1). In whole
 * minutes, as credit is counted (4.F.2): an 18:56 guarantee with 18:54 paid is 0:02 owed, not a fraction of a minute
 * that read "0.0 CH" owed and drafted a claim for it.
 */
export function guaranteeShortfall(guaranteeCH: number, paidCH: number): number {
  return Math.max(0, Math.round(guaranteeCH * 60) - Math.round(paidCH * 60)) / 60;
}

/**
 * Credit as a pilot types it: "14:30" as the pack and a pay statement print it, or hours and tenths ("14.5"). Null for
 * anything else. A number field read "14:30" as 1430 CH, and told a pilot paid 14:30 on an 18:56 trip there was nothing
 * to claim.
 */
export function parseCreditHours(text: string): number | null {
  const s = text.trim();
  const hm = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  return /^(\d{1,3}(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
}

/**
 * The claim for a trip paid under its guarantee, naming the trip by number and date: a line can fly the same trip
 * several times a month, and "trip 2192" alone doesn't say which one was paid short.
 */
export function payClaimText({
  pack,
  trip,
  date,
  guaranteeCH,
  paidCH,
}: {
  pack: Pick<BidPack, "base" | "aircraft" | "seat" | "month">;
  trip: Pick<Trip, "pairingNumber">;
  /** "Oct 15"; null when the pack doesn't date the trip. */
  date: string | null;
  guaranteeCH: number;
  paidCH: number;
}): string {
  const which = [`trip${trip.pairingNumber ? ` ${trip.pairingNumber}` : ""}`, date ? `on ${date}` : ""].filter(Boolean).join(" ");
  const hm = formatHoursValue;
  return (
    `Pay claim — ${which}, ${pack.base} ${pack.aircraft} ${pack.seat}, bid period ${pack.month}.\n\n` +
    `The trip's scheduled credit (trip guarantee) was ${hm(guaranteeCH)} CH. I was credited ${hm(paidCH)} CH. ` +
    "Under CBA 2026 Section 4.F.1, a pilot's trip guarantee is the greater of the trip's scheduled credit value when it was awarded/assigned or when the pilot started flying it. " +
    `I am claiming the ${hm(guaranteeShortfall(guaranteeCH, paidCH))} CH difference.`
  );
}
