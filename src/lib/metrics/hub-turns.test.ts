import { describe, expect, it } from "vitest";
import { hubTurnLabel, hubTurnsOf, summarizeHubTurns } from "@/lib/metrics/hub-turns";
import type { Trip, TripLeg } from "@/types/bidpack";

/**
 * Made-up trips shaped like the real ones: Dallas → Indianapolis in the evening, a sit through the sort, back out
 * before dawn, a day in a Dallas hotel, again the next night — and the ways a pack prints a turn at Memphis.
 */
const PACK = { bidPeriodStart: "2026-09-28", base: "MEM" };

function leg(fn: string, from: string, to: string, start: number, end: number, extra: Partial<TripLeg> = {}): TripLeg {
  const clock = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
  return {
    flightNumber: fn, equipment: "M1F", isDeadhead: !/^\d+$/.test(fn), depAirport: from, arrAirport: to,
    depTimeLocal: clock(start), depTimeGmt: clock(start), arrTimeLocal: clock(end), arrTimeGmt: clock(end),
    blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "", ...extra,
  };
}
type Duty = { legs: TripLeg[]; layover: boolean };
/** A trip reporting at 20:00 base time on bid-period day `day`; leg minutes count from that report. */
function trip(id: string, day: number, duties: Duty[]): Trip {
  return {
    id, pairingNumber: id, days: duties.length, layoverCities: [], layoverDetails: [], reportTime: "evening", international: false,
    deadheadLegs: 0, creditHours: 8, landings: 2, tafbHours: 24, departures: 2, startDayIndex: day, zuluAnchor: "",
    schedule: duties.map((d, i) => ({ reportTimeLocal: "2000", startMinutes: i * 1440, legs: d.legs, layover: d.layover ? { city: "DFW", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 15, startMinutes: 0, endMinutes: 0 } : null })),
  };
}
/** One night of Indianapolis hub turning out of Dallas, `n` days after the trip starts: in around 01:00, out 03:35. */
const night = (n: number, extra: Partial<TripLeg> = {}): Duty => ({
  legs: [leg("1601", "DFW", "IND", n * 1440 + 115, n * 1440 + 300, extra), leg("1735", "IND", "DFW", n * 1440 + 455, n * 1440 + 525)],
  layover: true,
});

describe("hub turns", () => {
  it("finds a night hub turn inside one duty and counts nights in a row", () => {
    const week = trip("10", 6, [night(0), night(1), night(2), night(3)]);
    const s = summarizeHubTurns(hubTurnsOf([week], PACK));
    expect(s).toMatchObject({ all: 4, night: 4, inWeeks: 4, longestRun: 4, withRestHotel: 0, hubs: ["IND"] });
    expect(hubTurnLabel(s)).toBe("Hub turns ×4 · IND, nights");
  });

  it("calls one or two nights in a row just that — not a week of them", () => {
    const s = summarizeHubTurns(hubTurnsOf([trip("39", 6, [night(0), night(1)])], PACK));
    expect(s).toMatchObject({ night: 2, inWeeks: 0, longestRun: 2 });
  });

  it("finds a turn printed across two duty lines with no layover between, and one across two pairings", () => {
    // DFW → MEM 00:33, then (a new duty line, no hotel) MEM 02:30 → DFW: the way the pack prints Memphis hub turns.
    const inMem: Duty = { legs: [leg("1201", "DFW", "MEM", 175, 270)], layover: false };
    const outMem: Duty = { legs: [leg("1471", "MEM", "DFW", 390, 480)], layover: true };
    expect(hubTurnsOf([trip("16", 8, [inMem, outMem])], PACK)).toHaveLength(1);
    // The same turn with each leg on its own pairing, flown back to back.
    const a = trip("16", 8, [{ legs: [leg("1201", "DFW", "MEM", 175, 270)], layover: false }]);
    const b = trip("17", 8, [{ legs: [leg("1471", "MEM", "DFW", 390, 480)], layover: true }]);
    const turns = hubTurnsOf([a, b], PACK);
    expect(turns).toHaveLength(1);
    expect([turns[0].inTrip, turns[0].outTrip]).toEqual(["16", "17"]);
  });

  it("isn't fooled by a layover, a deadhead or an airport that isn't a sort hub", () => {
    const layover = trip("1", 3, [{ legs: [leg("1201", "DFW", "MEM", 175, 270)], layover: true }, { legs: [leg("1471", "MEM", "DFW", 390, 480)], layover: false }]);
    const deadhead = trip("2", 3, [{ legs: [leg("AA10", "DFW", "IND", 115, 300), leg("1735", "IND", "DFW", 455, 525)], layover: true }]);
    const outstation = trip("3", 3, [{ legs: [leg("1601", "MEM", "PHX", 115, 300), leg("1602", "PHX", "MEM", 455, 525)], layover: true }]);
    expect(hubTurnsOf([layover, deadhead, outstation], PACK)).toEqual([]);
  });

  it("tells a hub turn by day from one by night, and marks the crew-rest hotel", () => {
    // In at 13:00 base time, out at 16:00: a day turn.
    const day = trip("24", 3, [{ legs: [leg("447", "PHL", "MEM", -500, -420), leg("550", "MEM", "PHL", -240, -150)], layover: true }]);
    expect(summarizeHubTurns(hubTurnsOf([day], PACK))).toMatchObject({ all: 1, night: 0, day: 1 });
    const nap = trip("98", 6, [night(0, { dayRoomHotel: "DELTA BY MARRIOTT" })]);
    const [t] = hubTurnsOf([nap], PACK);
    expect(t.restHotel).toBe("DELTA BY MARRIOTT");
    expect(hubTurnLabel(summarizeHubTurns([t]))).toBe("Hub turns ×1 · IND, nights · with crew-rest hotel");
  });
});
