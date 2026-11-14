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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** CBA 2026 4.F.2.a: a trip's rig, in CH, from its time away from base. */
export function tripRig(tafbHours: number): number {
  return round2(tafbHours / TAFB_HOURS_PER_RIG_CH);
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
  const guaranteeCH = round2(trip.creditHours);
  const rigCH = tripRig(trip.tafbHours);
  const daysAway = trip.tafbHours / 24;
  return { trip, guaranteeCH, rigCH, creditPerDayAway: daysAway > 0 ? round2(guaranteeCH / daysAway) : null };
}

export interface LinePay {
  trips: TripPay[];
  /** CBA 2026 4.B: the sum of the trips' guarantees — the Bid Line Guarantee before the floor. */
  tripGuaranteeTotal: number;
  /** CBA 2026 4.A.1: the floor the BLG can't fall below, and its section; null for an unusual bid-period length. */
  floor: { ch: number; section: string } | null;
  /** CBA 2026 4.B: the greater of the two — what the whole line guarantees this bid period. */
  blg: number;
  /** True when the floor, not the trips, set the BLG. */
  flooredUp: boolean;
}

/** The pay a regular line guarantees this bid period, from its trips. Carryover allocation (4.G) isn't applied here. */
export function linePay(line: Line, pack: Pick<BidPack, "bidPeriodDays">): LinePay {
  const trips = line.trips.map(tripPay);
  const tripGuaranteeTotal = round2(trips.reduce((a, t) => a + t.guaranteeCH, 0));
  const floor = minBidPeriodGuarantee(pack.bidPeriodDays);
  const blg = floor ? Math.max(tripGuaranteeTotal, floor.ch) : tripGuaranteeTotal;
  return { trips, tripGuaranteeTotal, floor, blg: round2(blg), flooredUp: !!floor && floor.ch > tripGuaranteeTotal };
}

/** What a pilot paid less than a trip's guarantee may claim: the shortfall, never negative (CBA 2026 4.F.1). */
export function guaranteeShortfall(guaranteeCH: number, paidCH: number): number {
  return round2(Math.max(0, guaranteeCH - paidCH));
}
