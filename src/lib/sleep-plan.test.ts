import { describe, expect, it } from "vitest";
import { driftBodyClock, planTripSleep, sleepPropensity } from "@/lib/sleep-plan";
import { buildTimelineDays } from "@/lib/trip-timeline";
import type { Trip, TripLeg } from "@/types/bidpack";

const clock = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}${String(x % 60).padStart(2, "0")}`;
};
/** A leg flown between two zones: times in trip minutes, where trip minute 0 is 00:00 UTC; offsets in minutes. */
function leg(from: string, to: string, start: number, end: number, depOff: number, arrOff: number): TripLeg {
  return {
    flightNumber: "101", equipment: "77", isDeadhead: false, depAirport: from, arrAirport: to,
    depTimeLocal: clock(start + depOff), depTimeGmt: clock(start), arrTimeLocal: clock(end + arrOff), arrTimeGmt: clock(end),
    blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: zulu(start), arrTimeZulu: zulu(end),
  } as TripLeg;
}
const zulu = (m: number) => new Date(Date.parse("2026-10-01T00:00:00.000Z") + m * 60_000).toISOString();
/** Two duties with a layover between: out, then home. */
function trip(out: TripLeg, back: TripLeg): Trip {
  return {
    id: "t", pairingNumber: "1", days: 3, layoverCities: [out.arrAirport], layoverDetails: [], reportTime: "mid", international: false, deadheadLegs: 0,
    creditHours: 10, landings: 2, tafbHours: 48, departures: 2, zuluAnchor: "2026-10-01T00:00:00.000Z", startDayIndex: 0,
    schedule: [
      { reportTimeLocal: "", startMinutes: out.startMinutes - 60, legs: [out], layover: { city: out.arrAirport, hotelName: null, transportToHotel: null, transportFromHotel: null, hours: (back.startMinutes - 60 - out.endMinutes) / 60, startMinutes: out.endMinutes, endMinutes: back.startMinutes - 60 } },
      { reportTimeLocal: "", startMinutes: back.startMinutes - 60, legs: [back], layover: null },
    ],
  } as unknown as Trip;
}
const H = 60;
const EST = -5 * H; // Memphis / Atlanta in October (CDT/EDT differ, but one zone keeps it simple)
const localHour = (m: number, off: number) => (((m + off) % 1440) + 1440) % 1440 / 60;

describe("sleep plan", () => {
  it("knows sleep comes easiest in the body's night and hardest just before bedtime", () => {
    expect(sleepPropensity(3 * H)).toBe(1);
    expect(sleepPropensity(20 * H)).toBeLessThan(0.2);
    expect(sleepPropensity(14.5 * H)).toBeGreaterThan(sleepPropensity(11 * H)); // the afternoon dip
  });

  it("shifts the body clock about an hour a day east, an hour and a half west, and the long way past nine hours east", () => {
    expect(driftBodyClock(0, 6 * H, 1440)).toBeCloseTo(60, 5);
    expect(driftBodyClock(0, -6 * H, 1440)).toBeCloseTo(-90, 5);
    // 10 hours east is adjusted by delaying: 14 hours west.
    expect(driftBodyClock(0, 10 * H, 1440)).toBeCloseTo(-90, 5);
  });

  it("puts a domestic overnight's sleep in the local night, ending on a full night", () => {
    // Out at 15:00 local, in at 17:00; home at 09:00 next morning.
    const t = trip(leg("MEM", "ATL", 20 * H, 22 * H, EST, EST), leg("ATL", "MEM", 38 * H, 40 * H, EST, EST));
    const [plan] = planTripSleep(t, EST);
    const main = plan.blocks.find((b) => b.kind === "sleep")!;
    expect(main.end - main.start).toBe(480);
    expect(localHour(main.start, EST)).toBeGreaterThanOrEqual(21.5);
    expect(plan.quality).toBe("good");
    expect(plan.bodyClockNote).toMatch(/on local time/);
  });

  it("after an all-nighter, before another night duty: core sleep on arrival, a nap before going", () => {
    // Out 02:00 local, in 05:00; next report 23:00 local.
    const t = trip(leg("MEM", "IAD", 7 * H, 10 * H, EST, EST), leg("IAD", "MEM", 29 * H, 31 * H, EST, EST));
    const [plan] = planTripSleep(t, EST);
    const kinds = plan.blocks.map((b) => b.kind);
    expect(kinds).toContain("preDuty");
    const first = plan.blocks[0];
    expect(first.start - plan.inHotel).toBeLessThanOrEqual(60); // straight to bed
    expect(plan.blocks.every((b) => b.start >= plan.inHotel && b.end <= plan.wakeBy)).toBe(true);
  });

  it("on a short layover, sleeps as soon as possible and wakes on a cycle boundary", () => {
    // In 23:00 local, out again 06:00: about 4 hours in bed.
    const t = trip(leg("MEM", "ATL", 26 * H, 28 * H, EST, EST), leg("ATL", "MEM", 36 * H, 37 * H, EST, EST));
    const [plan] = planTripSleep(t, EST);
    expect(plan.blocks).toHaveLength(1);
    expect((plan.blocks[0].end - plan.blocks[0].start) % 90).toBe(0);
    expect(plan.blocks[0].end).toBe(plan.wakeBy);
  });

  it("counts the crew-rest hotel nap on a night hub turn, and sleeps on arrival after it rather than waiting for the afternoon", () => {
    const EDT = -4 * H;
    // Two nights of PHL → IND 22:05–00:01 (crew-rest hotel through the sort), IND → PHL 04:20–05:58; a day in PHL between.
    const night = (d: number) => {
      const inbound = { ...leg("PHL", "IND", d + 125, d + 241, EDT, EDT), dayRoomHotel: "DELTA BY MARRIOTT" } as TripLeg;
      return { reportTimeLocal: "", startMinutes: d + 65, legs: [inbound, leg("IND", "PHL", d + 500, d + 598, EDT, EDT)] };
    };
    const n1 = night(0);
    const n2 = night(1440);
    const t = {
      ...trip(n1.legs[1], n2.legs[1]),
      schedule: [
        { ...n1, layover: { city: "PHL", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: (n2.startMinutes - 598) / 60, startMinutes: 598, endMinutes: n2.startMinutes } },
        { ...n2, layover: null },
      ],
    } as unknown as Trip;
    const [plan] = planTripSleep(t, EDT);
    expect(plan.dutyNap).toMatchObject({ city: "IND", hotel: "DELTA BY MARRIOTT", startLocal: "00:31", endLocal: "02:01" });
    expect(plan.dutyNap!.why).toMatch(/through the IND sort/);
    expect(plan.awakeHours).toBeCloseTo((598 + 45 - 361) / 60, 5); // up since the nap, not since the evening
    const first = plan.blocks[0];
    expect(first.kind).toBe("sleep");
    expect(first.start - plan.inHotel).toBeLessThanOrEqual(30); // straight to bed in the morning, not after the afternoon dip
    expect(plan.totalSleepHours).toBeCloseTo(plan.blocks.reduce((a, b) => a + b.end - b.start, 90) / 60, 5);
  });

  it("follows a body still on home time across the Pacific", () => {
    // Anchorage (UTC−8) to Osaka (UTC+9), landing 23:00 Osaka; home 40 hours later.
    const ANC = -8 * H;
    const KIX = 9 * H;
    const t = trip(leg("ANC", "KIX", 5 * H, 14 * H, ANC, KIX), leg("KIX", "ANC", 56 * H, 63 * H, KIX, ANC));
    const [plan] = planTripSleep(t, ANC);
    expect(plan.bodyClockNote).toMatch(/ahead of local time/);
    // The main sleep lands in the body's night — the Osaka afternoon and evening — not the Osaka night.
    const main = plan.blocks.find((b) => b.kind === "sleep")!;
    const startsAt = localHour(main.start, KIX);
    expect(startsAt).toBeGreaterThan(12);
    expect(startsAt).toBeLessThan(21);
    // …and nobody is left awake for a day to get there.
    expect(plan.blocks[0].start - plan.inHotel).toBeLessThan(3 * H);
  });

  it("draws on the hotel stay's own days, and never moves the trip's days — even across the date line", () => {
    const ANC = -8 * H;
    const KIX = 9 * H;
    const t = trip(leg("ANC", "KIX", 5 * H, 14 * H, ANC, KIX), leg("KIX", "ANC", 56 * H, 63 * H, KIX, ANC));
    const plans = planTripSleep(t, ANC);
    for (const mode of ["local", "zulu"] as const) {
      const plain = buildTimelineDays(t, mode);
      const withSleep = buildTimelineDays(t, mode, plans);
      expect(withSleep.map((d) => d.segments)).toEqual(plain.map((d) => d.segments));
      const pieces = withSleep.flatMap((d) => (d.sleep ?? []).map((s) => ({ d, s })));
      expect(pieces.length).toBeGreaterThan(0);
      for (const { d, s } of pieces) expect(d.segments.some((x) => x.kind === "layover" && x.startMinuteOfDay <= s.startMinuteOfDay && x.endMinuteOfDay >= s.endMinuteOfDay)).toBe(true);
    }
  });
});
