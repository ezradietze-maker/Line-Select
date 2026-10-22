import { describe, expect, it } from "vitest";
import { METRICS } from "@/lib/metrics/catalog";
import { scoreTripsV2, tripKey, tripReadingOf, tripValueText } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

/** Bid period starts Monday Sep 28 2026: day indexes 5 and 6 are the first Saturday and Sunday. */
const START = "2026-09-28";

function leg(fn: string, from: string, to: string, start: number, end: number): TripLeg {
  const clock = (m: number) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}${String(x % 60).padStart(2, "0")}`;
  };
  return {
    flightNumber: fn, equipment: /^\d/.test(fn) ? "77" : "JET", isDeadhead: !/^\d+$/.test(fn), depAirport: from, arrAirport: to,
    depTimeLocal: clock(start), depTimeGmt: clock(start), arrTimeLocal: clock(end), arrTimeGmt: clock(end),
    blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "",
  } as TripLeg;
}

/** A daytime trip out of MEM: one operated leg a day, a night in a city between, home on the last day. */
function trip(id: string, days: number, startDayIndex: number, opts: { deadheadOut?: boolean } = {}): Trip {
  const cities = ["DEN", "SEA", "BOS", "MIA", "ORD", "PHX", "SLC", "DFW"];
  const schedule = Array.from({ length: days }, (_, d) => {
    const from = d === 0 ? "MEM" : cities[d - 1];
    const to = d === days - 1 ? "MEM" : cities[d];
    const dep = d * 1440 + 600;
    // Opening with a deadhead out of base: a commuter can fly straight to where the flying starts.
    const out = d === 0 && opts.deadheadOut ? [leg("DL1", "MEM", "ATL", dep - 300, dep - 120), leg(String(100 + d), "ATL", to, dep, dep + 240)] : [leg(String(100 + d), from, to, dep, dep + 240)];
    return {
      reportTimeLocal: "0900",
      startMinutes: dep - 60,
      legs: out,
      layover: d === days - 1 ? null : { city: to, hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: dep + 240, endMinutes: dep + 1440 },
    };
  });
  return {
    id, pairingNumber: id, days, layoverCities: cities.slice(0, days - 1), layoverDetails: [], reportTime: "mid", international: false, deadheadLegs: 0,
    creditHours: 6 * days, landings: days, tafbHours: days * 24, departures: days, zuluAnchor: "2026-10-01T00:00:00.000Z", startDayIndex, schedule,
  } as unknown as Trip;
}

const SHORT = trip("S", 2, 1); // Tue–Wed
const LONG = trip("L", 8, 8); // a week out, over the second weekend
const WEEKEND = trip("W", 2, 5); // Sat–Sun
const MIDWEEK = trip("M", 2, 15); // Tue–Wed
const lines: Line[] = [
  { id: "1", lineNumber: "1", trips: [SHORT, LONG], daysOff: 14, totalCreditHours: 60, totalTafbHours: 240, totalLandings: 10, totalDepartures: 10 },
  { id: "2", lineNumber: "2", trips: [WEEKEND, MIDWEEK], daysOff: 14, totalCreditHours: 24, totalTafbHours: 96, totalLandings: 4, totalDepartures: 4 },
] as unknown as Line[];
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: START, lines } as unknown as BidPack;

const crit = (over: Partial<Criterion>): Criterion => ({ id: over.metric ?? "c", metric: "daysOff", shape: { kind: "more" }, tier: "high", weight: 1, confidence: 1, label: over.metric ?? "c", evidence: [], status: "settled", ...over });
const model = (criteria: Criterion[]): PilotModel => ({ version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria });
const score = (m: PilotModel, t: Trip) => scoreTripsV2(pack, m).get(tripKey(t))!;

describe("trip scores", () => {
  it("decides, for every measurement in the library, what it means for one trip", () => {
    const undecided = METRICS.filter((d) => tripReadingOf(d) === undefined).map((d) => d.id);
    expect(undecided).toEqual([]);
  });

  it("counts what a line adds up over the month as the trip's own count", () => {
    const m = model([crit({ metric: "baseCommutesNeeded", shape: { kind: "less" } })]);
    const short = score(m, SHORT);
    expect(short.results[0].value).toBe(2);
    expect(tripValueText(short.results[0])).toBe("2 commutes on this trip");
    // Starting on a deadhead saves a commute: one instead of two.
    const out = trip("D", 4, 20, { deadheadOut: true });
    const withOut = { ...pack, lines: [...lines, { ...lines[0], id: "4", lineNumber: "4", trips: [out] }] } as BidPack;
    const scores = scoreTripsV2(withOut, m);
    expect(scores.get(tripKey(out))!.results[0].raw).toBe(1);
    expect(scores.get(tripKey(out))!.score).toBeGreaterThan(scores.get(tripKey(SHORT))!.score);
  });

  it("moves a pilot's monthly numbers to the same place among trips", () => {
    // Lines with 2, 4, 6 and 8 commutes; trips with one (deadhead out) or two.
    const d1 = trip("D1", 3, 1, { deadheadOut: true });
    const d2 = trip("D2", 3, 8, { deadheadOut: true });
    const n = (id: string, start: number) => trip(id, 2, start);
    const ls = [
      [d1, d2],
      [n("A", 1), n("B", 8)],
      [n("C", 1), n("D", 8), n("E", 15)],
      [n("F", 1), n("G", 8), n("H", 15), n("I", 22)],
    ].map((trips, i) => ({ id: `x${i}`, lineNumber: `x${i}`, trips, daysOff: 14, totalCreditHours: 50, totalTafbHours: 100, totalLandings: 4, totalDepartures: 4 })) as unknown as Line[];
    const p2 = { ...pack, lines: ls } as BidPack;
    // "Two commutes a month is fine, eight is as bad as it gets": the best and worst lines, so the best and worst trips.
    const m = model([crit({ metric: "baseCommutesNeeded", shape: { kind: "less", fineAt: 2, worstAt: 8 } })]);
    const s = scoreTripsV2(p2, m);
    expect(s.get(tripKey(d1))!.results[0].utility).toBeCloseTo(1, 5);
    expect(s.get(tripKey(n("A", 1)))!.results[0].utility).toBeCloseTo(0, 5);
  });

  it("still tells one commute from two when most trips take two and the monthly number is lenient", () => {
    // Lines with 3, 4, 4 and 6 commutes; every trip takes two but one, which starts on a deadhead.
    const d1 = trip("D1", 3, 1, { deadheadOut: true });
    const n = (id: string, start: number) => trip(id, 2, start);
    const ls = [
      [d1, n("A", 8)],
      [n("B", 1), n("C", 8)],
      [n("E", 1), n("F", 8)],
      [n("G", 1), n("H", 8), n("I", 15)],
    ].map((trips, i) => ({ id: `y${i}`, lineNumber: `y${i}`, trips, daysOff: 14, totalCreditHours: 50, totalTafbHours: 100, totalLandings: 4, totalDepartures: 4 })) as unknown as Line[];
    const p2 = { ...pack, lines: ls } as BidPack;
    // "Four a month is fine" covers three lines in four — but a trip that needs one commute is still better than two.
    const s = scoreTripsV2(p2, model([crit({ metric: "baseCommutesNeeded", shape: { kind: "less", fineAt: 4 } })]));
    expect(s.get(tripKey(d1))!.score).toBeGreaterThan(s.get(tripKey(n("A", 8)))!.score);
  });

  it("never caps a trip for a monthly limit it can't break on its own", () => {
    const m = model([crit({ metric: "baseCommutesNeeded", shape: { kind: "less", fineAt: 3, worstAt: 5 }, hardLimit: { op: "max", value: 5 } })]);
    expect(score(m, SHORT).violations).toEqual([]);
  });

  it("caps a trip that breaks a dealbreaker by itself", () => {
    const m = model([crit({ metric: "longestTripDays", shape: { kind: "less", fineAt: 3 }, hardLimit: { op: "max", value: 5 } })]);
    expect(score(m, LONG).violations).toHaveLength(1);
    expect(score(m, SHORT).violations).toEqual([]);
  });

  it("counts the weekend days the trip itself works", () => {
    const m = model([crit({ metric: "weekendDaysOff", shape: { kind: "more" } })]);
    const weekend = score(m, WEEKEND);
    const midweek = score(m, MIDWEEK);
    expect(midweek.score).toBeGreaterThan(weekend.score);
    expect(tripValueText(weekend.results[0])).toBe("works 2 weekend days");
    expect(tripValueText(midweek.results[0])).toBe("no weekend days");
  });

  it("holds a trip that works a date they must have off to their dealbreaker", () => {
    // Oct 3 is day index 5.
    const m = model([crit({ metric: "requestedDatesWorked", params: { dates: ["2026-10-03"] }, shape: { kind: "less", fineAt: 0 }, hardLimit: { op: "max", value: 0 } })]);
    expect(score(m, WEEKEND).violations).toHaveLength(1);
    expect(score(m, MIDWEEK).violations).toEqual([]);
  });

  it("leaves out what one trip can't show, rather than counting it as average", () => {
    const m = model([crit({ metric: "daysOff" }), crit({ metric: "avgTripDays", shape: { kind: "less" } })]);
    const s = score(m, SHORT);
    expect(s.notApplicable.map((n) => n.criterionId)).toEqual(["daysOff"]);
    expect(s.results.map((r) => r.metric)).toEqual(["avgTripDays"]);
  });

  it("never goes below zero, however far past the bad end a trip is", () => {
    // An 8-day trip against "a day is fine, two is as bad as it gets": six days past the bad end.
    const m = model([crit({ metric: "longestTripDays", shape: { kind: "less", fineAt: 1, worstAt: 2 } })]);
    expect(score(m, LONG).score).toBe(0);
  });

  it("scores the same pairing on the same day once, wherever it's flown", () => {
    const again: Line = { ...lines[0], id: "3", lineNumber: "3" };
    const withRepeat = { ...pack, lines: [...lines, again] } as BidPack;
    const m = model([crit({ metric: "avgTripDays", shape: { kind: "less" } })]);
    expect(scoreTripsV2(withRepeat, m).size).toBe(4);
  });
});
