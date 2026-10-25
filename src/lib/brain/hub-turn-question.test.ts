import { describe, expect, it } from "vitest";
import { HUB_TURNS_LEAD, nextHubTurnQuestion, REST_HOTEL_LEAD } from "@/lib/brain/hub-turn-question";
import { modelToHubTurns } from "@/lib/brain/model-upgrade";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

function leg(fn: string, from: string, to: string, start: number, end: number, extra: Partial<TripLeg> = {}): TripLeg {
  const clock = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
  return { flightNumber: fn, equipment: "M1F", isDeadhead: false, depAirport: from, arrAirport: to, depTimeLocal: clock(start), depTimeGmt: clock(start), arrTimeLocal: clock(end), arrTimeGmt: clock(end), blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "", ...extra };
}
/** `nights` nights of hub turning at `hub` out of DFW, starting on bid-period day `day`. */
function hubTrip(id: string, day: number, nights: number, hub = "IND", extra: Partial<TripLeg> = {}): Trip {
  const schedule = Array.from({ length: nights }, (_, n) => ({
    reportTimeLocal: "2000", startMinutes: n * 1440,
    legs: [leg("1601", "DFW", hub, n * 1440 + 115, n * 1440 + 300, extra), leg("1735", hub, "DFW", n * 1440 + 455, n * 1440 + 525)],
    layover: { city: "DFW", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 15, startMinutes: 0, endMinutes: 0 },
  }));
  return { id, pairingNumber: id, days: nights, layoverCities: ["DFW"], layoverDetails: [], reportTime: "evening", international: false, deadheadLegs: 0, creditHours: 8 * nights, landings: 2 * nights, tafbHours: 24 * nights, departures: 2 * nights, startDayIndex: day, zuluAnchor: "", schedule } as Trip;
}
const line = (id: string, trips: Trip[]) => ({ id, lineNumber: id, trips, daysOff: 14, totalCreditHours: 70, totalTafbHours: 200, totalLandings: 10, totalDepartures: 10 }) as unknown as Line;
const pack = (lines: Line[]) => ({ id: "p", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines }) as unknown as BidPack;

describe("the hub-turn question", () => {
  it("asks about a week of night hub turns with a real trip, then about the crew-rest hotel, once each", () => {
    const p = pack([line("1", [hubTrip("10", 6, 4)]), line("2", [hubTrip("98", 6, 4, "IND", { dayRoomHotel: "DELTA BY MARRIOTT" })]), line("3", [hubTrip("39", 3, 1)])]);
    const pm = prepareMetrics(p);
    const first = nextHubTurnQuestion(p, null, pm, [])!;
    expect(first.transcript.startsWith(HUB_TURNS_LEAD)).toBe(true);
    // The plain week, not the one with the nap — that's asked about on its own.
    expect(first.helpText).toContain("Trip #10");
    expect(first.helpText).toContain("4 nights in a row");
    const second = nextHubTurnQuestion(p, null, pm, [{ question: first.transcript }])!;
    expect(second.transcript.startsWith(REST_HOTEL_LEAD)).toBe(true);
    expect(second.helpText).toContain("DELTA BY MARRIOTT");
    expect(nextHubTurnQuestion(p, null, pm, [{ question: first.transcript }, { question: second.transcript }])).toBeNull();
  });

  it("isn't asked when hub turns aren't part of the pack", () => {
    const p = pack([line("1", [hubTrip("39", 3, 1)]), ...Array.from({ length: 9 }, (_, i) => line(`x${i}`, []))]);
    expect(nextHubTurnQuestion(p, null, prepareMetrics(p), [])).toBeNull();
  });
});

describe("modelToHubTurns", () => {
  const crit = (over: Partial<Criterion>): Criterion => ({ id: "c", metric: "longestNightStreak", label: "Avoid weeks of back-to-back night turns", shape: { kind: "less", fineAt: 1 }, tier: "medium", weight: 0.3, confidence: 0.7, evidence: [], status: "settled", ...over });
  const model = (criteria: Criterion[]): PilotModel => ({ version: 2, home: null, criteria, threads: [], notMeasurable: [], synopsis: "" });

  it("moves a night-streak priority about hub turns to the hub-turn measure, at the same weight", () => {
    const m = modelToHubTurns(model([crit({ evidence: [{ quote: "a couple weeks of back-to-back night hub turning", turn: 6 }] })]));
    expect(m.criteria[0]).toMatchObject({ metric: "nightHubTurnRuns", weight: 0.3, shape: { kind: "less", fineAt: 0 } });
  });

  it("leaves a night streak that isn't about hub turns alone", () => {
    const m = model([crit({ evidence: [{ quote: "two all-nighters in a row is my limit", turn: 2 }] })]);
    expect(modelToHubTurns(m)).toBe(m);
  });
});
