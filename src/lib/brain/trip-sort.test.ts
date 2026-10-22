import { describe, expect, it } from "vitest";
import { askedTripScreens, choicesFromGrades, pickTripScreen, tripGradesAnswer, tripGradesTranscript, wantsAnotherScreen, MAX_SCREENS, MIN_SCREENS } from "@/lib/brain/trip-sort";
import { prepareMetrics } from "@/lib/metrics/compute";
import { rankLinesWithTrips, TRIP_LEAN } from "@/lib/scoring-v2/trip-score";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

function leg(fn: string, from: string, to: string, start: number, end: number): TripLeg {
  const clock = (m: number) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}${String(x % 60).padStart(2, "0")}`;
  };
  return { flightNumber: fn, equipment: "77", isDeadhead: false, depAirport: from, arrAirport: to, depTimeLocal: clock(start), depTimeGmt: clock(start), arrTimeLocal: clock(end), arrTimeGmt: clock(end), blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "" } as TripLeg;
}
/** A trip out of MEM with `legsPerDay` operated legs a day and a layover city between days. */
function trip(id: string, days: number, start: number, legsPerDay: number, city: string): Trip {
  const schedule = Array.from({ length: days }, (_, d) => {
    const dep = d * 1440 + 600;
    const legs = Array.from({ length: legsPerDay }, (_, k) => leg(String(100 + k), k === 0 ? (d === 0 ? "MEM" : city) : "IND", k === legsPerDay - 1 ? (d === days - 1 ? "MEM" : city) : "IND", dep + k * 200, dep + k * 200 + 150));
    return { reportTimeLocal: "0900", startMinutes: dep - 60, legs, layover: d === days - 1 ? null : { city, hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: dep + 400, endMinutes: dep + 1440 } };
  });
  return { id, pairingNumber: id, days, layoverCities: [city], layoverDetails: [], reportTime: "mid", international: false, deadheadLegs: 0, creditHours: 6 * days, landings: days * legsPerDay, tafbHours: days * 24, departures: days * legsPerDay, zuluAnchor: "2026-10-01T00:00:00.000Z", startDayIndex: start, schedule } as unknown as Trip;
}
const cities = ["SEA", "BOS", "DEN", "PHX", "MIA", "SLC"];
const lines: Line[] = Array.from({ length: 6 }, (_, i) => ({
  id: `L${i}`,
  lineNumber: `L${i}`,
  trips: [trip(`A${i}`, 2 + (i % 3), 1, 1 + (i % 2), cities[i]), trip(`B${i}`, 3, 10, 2 - (i % 2), cities[(i + 1) % 6]), trip(`C${i}`, 2, 20, 1 + ((i + 1) % 2), cities[(i + 2) % 6])],
  daysOff: 14,
  totalCreditHours: 60,
  totalTafbHours: 200,
  totalLandings: 10,
  totalDepartures: 10,
})) as unknown as Line[];
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines } as unknown as BidPack;
const crit = (over: Partial<Criterion>): Criterion => ({ id: over.metric ?? "c", metric: "extraLegs", shape: { kind: "less" }, tier: "high", weight: 1, confidence: 1, label: over.metric ?? "c", evidence: [], status: "settled", ...over });
const model: PilotModel = {
  version: 2,
  home: null,
  threads: [],
  notMeasurable: [],
  synopsis: "",
  criteria: [crit({ metric: "extraLegs" }), crit({ metric: "creditHours", shape: { kind: "more" }, weight: 0.6 }), crit({ metric: "layoverCount", shape: { kind: "more" }, weight: 0.4 })],
};

describe("trip grades", () => {
  it("turns grades into choices: every two trips graded differently, 'easily' when two grades apart", () => {
    const cs = choicesFromGrades({ a: "love", b: "good", c: "poor", d: undefined });
    expect(cs).toContainEqual({ preferred: "a", other: "b", strength: "slightly" });
    expect(cs).toContainEqual({ preferred: "a", other: "c", strength: "strongly" });
    expect(cs).toContainEqual({ preferred: "b", other: "c", strength: "strongly" });
    expect(cs).toHaveLength(3);
  });

  it("asks two screens, then a third only while the last one surprised the model", () => {
    expect(wantsAnotherScreen(0, null)).toBe(true);
    expect(wantsAnotherScreen(MIN_SCREENS - 1, 1)).toBe(true);
    expect(wantsAnotherScreen(MIN_SCREENS, 0.95)).toBe(false);
    expect(wantsAnotherScreen(MIN_SCREENS, 0.5)).toBe(true);
    expect(wantsAnotherScreen(MAX_SCREENS, 0.1)).toBe(false);
  });

  it("picks real trips from the best lines, never two dates of one trip or one already shown, and reads them back from the transcript", () => {
    const pm = prepareMetrics(pack);
    const first = pickTripScreen(pack, model, pm, [], { size: 5 })!;
    expect(first.keys.length).toBe(5);
    const pairings = (keys: string[]) => keys.map((k) => k.split("@")[0]);
    expect(new Set(pairings(first.keys)).size).toBe(5);
    const transcript = [{ question: tripGradesTranscript(first) }];
    expect(askedTripScreens(transcript)).toEqual([first.keys]);
    const second = pickTripScreen(pack, model, pm, askedTripScreens(transcript), { size: 5 })!;
    expect(pairings(second.keys).some((p) => pairings(first.keys).includes(p))).toBe(false);
    expect(tripGradesAnswer(first, { [first.keys[0]]: "love" }, "short and easy")).toBe(`${first.labels[first.keys[0]]}: love. Why: short and easy`);
  });
});

describe("lines with their trips", () => {
  it("leaves lines alone until the pilot has graded trips, then takes their trip grades into account", () => {
    const pm = prepareMetrics(pack);
    const plain = scorePackV2(pack, model, { pack: pm });
    expect(rankLinesWithTrips(pack, model, { pack: pm }).map((s) => s.score).sort()).toEqual(plain.map((s) => s.score).sort());
    const graded: PilotModel = { ...model, tripWeights: { extraLegs: 3, creditHours: 0.5, layoverCount: 1 } };
    const leaned = new Map(rankLinesWithTrips(pack, graded, { pack: pm }).map((s) => [s.lineId, s.score]));
    const base = new Map(scorePackV2(pack, graded, { pack: pm }).map((s) => [s.lineId, s.score]));
    expect([...leaned].some(([id, v]) => Math.abs(v - base.get(id)!) > 0.05)).toBe(true);
    // A small adjustment, not a different ranking: lessons are partial and the lean is light.
    for (const [id, v] of leaned) expect(Math.abs(v - base.get(id)!)).toBeLessThan(15);
    expect(TRIP_LEAN).toBeLessThan(0.2);
  });
});
