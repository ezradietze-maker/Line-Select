import { describe, expect, it } from "vitest";
import { dayStats, equipmentLabel, hm, tripBlockMinutes, tripDayDate, tripRoute } from "@/lib/trip-day-stats";
import type { TimelineSegment } from "@/lib/trip-timeline";
import type { Trip, TripLeg } from "@/types/bidpack";

function seg(kind: TimelineSegment["kind"], start: number, end: number, extra: Partial<TimelineSegment> = {}): TimelineSegment {
  return { kind, label: "", detail: "", inlineStart: "", inlineEnd: "", startMinuteOfDay: start, endMinuteOfDay: end, continuesFromPreviousDay: false, continuesToNextDay: false, ...extra };
}

const leg = (blockMinutes: number) => ({
  flightNumber: "3800", dep: "ORD", arr: "OAK", depClock: "07:00", arrClock: "09:37", depClockAlt: "12:00", arrClockAlt: "16:37", blockMinutes, equipment: "76", deadhead: false,
});

describe("a day's own numbers", () => {
  it("reads duty start, last block-in, block time and landings off the day", () => {
    const st = dayStats({
      dayNumber: 2,
      segments: [seg("layover", 0, 330), seg("ground", 330, 420), seg("flying", 420, 577, { leg: leg(277) }), seg("layover", 577, 1440, { continuesToNextDay: true })],
    });
    expect(st).toMatchObject({ onDuty: "05:30", lastIn: "09:37", dutyEnd: "09:37", landings: 1, continuesOut: false, restDay: false });
    // 07:00 Chicago to 09:37 Oakland is a 4:37 flight, not the 2:37 the two local clocks differ by.
    expect(hm(st.blockMinutes)).toBe("4:37");
  });

  it("counts a flight over midnight on the day it departs and lands it on the next", () => {
    const flight = leg(390);
    const d1 = dayStats({ dayNumber: 1, segments: [seg("ground", 1240, 1300), seg("flying", 1300, 1440, { leg: flight, continuesToNextDay: true })] });
    const d2 = dayStats({ dayNumber: 2, segments: [seg("flying", 0, 340, { leg: flight, continuesFromPreviousDay: true })] });
    expect(d1).toMatchObject({ onDuty: "20:40", lastIn: null, landings: 0, continuesOut: true });
    expect(d1.blockMinutes).toBe(390);
    expect(d2).toMatchObject({ onDuty: null, lastIn: "05:40", landings: 1, continuesIn: true, blockMinutes: 0 });
  });

  it("knows a day at the hotel, and a standby day that ends when standby does", () => {
    expect(dayStats({ dayNumber: 3, segments: [seg("layover", 0, 1440, { continuesFromPreviousDay: true, continuesToNextDay: true })] }).restDay).toBe(true);
    const sby = dayStats({ dayNumber: 1, segments: [seg("standby", 90, 780), seg("layover", 780, 1440, { continuesToNextDay: true })] });
    expect(sby).toMatchObject({ onDuty: "01:30", lastIn: null, dutyEnd: "13:00", standby: true, blockMinutes: 0 });
  });

  it("keeps last night's duty and tonight's apart instead of one backwards window", () => {
    // Lands 06:13 from an overnight duty, hotel all day, picked up 23:20 for a 23:50 deadhead.
    const st = dayStats({
      dayNumber: 2,
      segments: [
        seg("flying", 0, 373, { continuesFromPreviousDay: true, leg: leg(300) }),
        seg("layover", 373, 1400),
        seg("ground", 1400, 1430),
        seg("deadhead", 1430, 1440, { continuesToNextDay: true, leg: { ...leg(90), deadhead: true } }),
      ],
    });
    expect(st.windows).toEqual([
      { start: null, end: "06:13" },
      { start: "23:20", end: null },
    ]);
  });

  it("gives an ordinary day a single window", () => {
    const st = dayStats({ dayNumber: 2, segments: [seg("layover", 0, 330), seg("ground", 330, 420), seg("flying", 420, 577, { leg: leg(277) }), seg("layover", 577, 1440, { continuesToNextDay: true })] });
    expect(st.windows).toEqual([{ start: "05:30", end: "09:37" }]);
  });

  it("keeps deadheads out of block time", () => {
    const st = dayStats({ dayNumber: 1, segments: [seg("deadhead", 600, 722, { leg: { ...leg(122), deadhead: true } })] });
    expect(st.blockMinutes).toBe(0);
    expect(st.deadheadMinutes).toBe(122);
    expect(st.landings).toBe(0);
  });
});

function makeLeg(over: Partial<TripLeg>): TripLeg {
  return {
    flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "0900", depTimeGmt: "1400", arrAirport: "ORD", arrTimeLocal: "1000", arrTimeGmt: "1500",
    blockHours: 1.5, startMinutes: 60, endMinutes: 150, depTimeZulu: "", arrTimeZulu: "", ...over,
  };
}

const trip: Trip = {
  id: "t", pairingNumber: "445", days: 3, layoverCities: ["ORD"], layoverDetails: [], reportTime: "early", international: false, deadheadLegs: 1, creditHours: 10, landings: 2, tafbHours: 50, departures: 3,
  zuluAnchor: "2026-09-28T14:00:00.000Z", startDayIndex: 3,
  schedule: [
    { reportTimeLocal: "0800", startMinutes: 0, legs: [makeLeg({ isDeadhead: true, equipment: "JET" })], layover: { city: "ORD", hotelName: "Westin", transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: 150, endMinutes: 1350 } },
    { reportTimeLocal: "0700", startMinutes: 1350, legs: [makeLeg({ depAirport: "ORD", arrAirport: "OAK", blockHours: 4.62 }), makeLeg({ depAirport: "OAK", arrAirport: "MEM", blockHours: 3.5 })], layover: null },
  ],
};

describe("the trip's own numbers", () => {
  it("lists every stop once, in order", () => {
    expect(tripRoute(trip)).toEqual(["MEM", "ORD", "OAK", "MEM"]);
  });

  it("adds up operated block time, leaving the deadhead out", () => {
    expect(hm(tripBlockMinutes(trip)!)).toBe("8:07");
  });

  it("dates each trip day from the bid period's start", () => {
    // Bid period starts Mon 28 Sep 2026; the trip starts on its 4th day.
    expect(tripDayDate(trip, "2026-09-28", 1)).toEqual({ weekday: "Thu", day: 1, month: "Oct" });
    expect(tripDayDate(trip, "2026-09-28", 3)).toEqual({ weekday: "Sat", day: 3, month: "Oct" });
    expect(tripDayDate(trip, null, 1)).toBeNull();
    expect(tripDayDate({ ...trip, startDayIndex: null }, "2026-09-28", 1)).toBeNull();
  });

  it("says how a pilot gets there in plain words", () => {
    expect(equipmentLabel("JET", true)).toBe("airline");
    expect(equipmentLabel("CAB", true)).toBe("ground");
    expect(equipmentLabel("76", false)).toBe("76");
  });
});
