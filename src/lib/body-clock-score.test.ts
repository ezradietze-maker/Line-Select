import { describe, expect, it } from "vitest";
import { lineBodyClockScore, tripBodyClockScore } from "@/lib/body-clock-score";
import type { Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";

// A trip's minute 0 is 05:00 UTC — midnight in Memphis (UTC−5 in October).
const ZERO = Date.parse("2026-10-05T05:00:00Z");
const MEM = -300;
const hhmm = (m: number) => {
  const d = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, "0")}${String(d % 60).padStart(2, "0")}`;
};
const iso = (m: number) => new Date(ZERO + m * 60_000).toISOString();

/** A leg leaving at trip minute `start` for `minutes`, from a city at UTC offset `from` to one at `to`. */
function leg(start: number, minutes: number, from = MEM, to = MEM, dep = "MEM", arr = "MEM"): TripLeg {
  const end = start + minutes;
  return {
    flightNumber: "1",
    equipment: "M1",
    isDeadhead: false,
    depAirport: dep,
    depTimeLocal: hhmm(start + 300 + from),
    depTimeGmt: hhmm(start + 300),
    arrAirport: arr,
    arrTimeLocal: hhmm(end + 300 + to),
    arrTimeGmt: hhmm(end + 300),
    blockHours: minutes / 60,
    startMinutes: start,
    endMinutes: end,
    depTimeZulu: iso(start),
    arrTimeZulu: iso(end),
  };
}

/** A duty reporting an hour before its first leg; a layover from its last leg to `next` (the next duty's report), in `city`. */
function duty(legs: TripLeg[], next?: number, city = "XXX"): TripDutyPeriod {
  const report = legs[0].startMinutes - 60;
  const end = legs.at(-1)!.endMinutes;
  return {
    reportTimeLocal: "0000",
    startMinutes: report,
    legs,
    layover: next === undefined ? null : { city, hotelName: null, transportToHotel: null, transportFromHotel: null, hours: (next - end) / 60, startMinutes: end, endMinutes: next },
  };
}

function trip(schedule: TripDutyPeriod[], startDayIndex = 0): Trip {
  const shift = schedule[0].startMinutes;
  // The trip's own clock starts at its first report.
  const at = (m: number) => m - shift;
  const shifted = schedule.map((d) => ({
    ...d,
    startMinutes: at(d.startMinutes),
    legs: d.legs.map((l) => ({ ...l, startMinutes: at(l.startMinutes), endMinutes: at(l.endMinutes) })),
    layover: d.layover ? { ...d.layover, startMinutes: at(d.layover.startMinutes), endMinutes: at(d.layover.endMinutes) } : null,
  }));
  return {
    id: `t${startDayIndex}-${schedule.length}-${schedule[0].legs[0].startMinutes}-${schedule.map((d) => d.legs.map((l) => `${l.depTimeGmt}${l.arrTimeGmt}`).join()).join()}`,
    pairingNumber: "1",
    days: Math.ceil((schedule.at(-1)!.legs.at(-1)!.endMinutes - schedule[0].startMinutes) / 1440) || 1,
    layoverCities: [],
    layoverDetails: [],
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: 10,
    landings: schedule.length,
    tafbHours: 24,
    departures: schedule.length,
    zuluAnchor: new Date(ZERO + shift * 60_000).toISOString(),
    startDayIndex,
    schedule: shifted,
  };
}

const H = 60;
/** A day trip: out at 10:00, a 20-hour layover, back at 10:00 the next day — nothing in the body's night. */
const dayTrip = () => trip([duty([leg(10 * H, 90)], 34 * H), duty([leg(35 * H, 90)])]);
/** `n` duties in a row flown 22:00–04:00 Memphis time, each a night apart. */
const nightTrip = (n: number, spacingDays = 1) =>
  trip(Array.from({ length: n }, (_, i) => duty([leg((22 + 24 * spacingDays * i) * H, 6 * H)], i < n - 1 ? (22 + 24 * spacingDays * (i + 1)) * H - 2 * H : undefined)));

describe("tripBodyClockScore", () => {
  it("scores a day trip with a full night between duties near 100, with nothing to answer for", () => {
    const s = tripBodyClockScore(dayTrip(), MEM)!;
    expect(s.score).toBeGreaterThanOrEqual(95);
    expect(s.factors.map((f) => f.id)).not.toContain("night");
    expect(s.factors.map((f) => f.id)).not.toContain("flips");
  });

  it("costs every hour on duty in the body's 02:00–06:00, and a flip onto nights and back", () => {
    const s = tripBodyClockScore(nightTrip(1), MEM)!;
    expect(s.counts.nightDuties).toBe(1);
    expect(s.counts.nightHours).toBeCloseTo(2, 0);
    expect(s.counts.flips).toBe(2);
    expect(s.score).toBeLessThan(tripBodyClockScore(dayTrip(), MEM)!.score);
    expect(s.factors.find((f) => f.id === "night")?.science).toMatch(/circadian low/);
  });

  it("counts each night in a row for more — but not nights with a day off between them", () => {
    const run = tripBodyClockScore(nightTrip(4), MEM)!;
    const spaced = tripBodyClockScore(nightTrip(4, 2), MEM)!;
    expect(run.counts.longestNightRun).toBe(4);
    expect(spaced.counts.longestNightRun).toBe(1);
    expect(run.factors.some((f) => f.id === "nightRun")).toBe(true);
    expect(spaced.factors.some((f) => f.id === "nightRun")).toBe(false);
    expect(run.score).toBeLessThan(spaced.score);
  });

  it("costs more past the pilot's own stated limit on nights in a row", () => {
    expect(tripBodyClockScore(nightTrip(4), MEM, 1)!.score).toBeLessThan(tripBodyClockScore(nightTrip(4), MEM)!.score);
  });

  it("costs an early report, more the earlier", () => {
    const at = (h: number) => tripBodyClockScore(trip([duty([leg(h * H + H, 90)])]), MEM)!;
    expect(at(6.5).counts.earlyReports).toBe(1);
    expect(at(4.5).score).toBeLessThan(at(6.5).score);
    expect(at(9).counts.earlyReports).toBe(0);
  });

  it("costs a layover too short for 7 hours of sleep", () => {
    // In at 11:30, out again at 18:30: seven hours on the ground, under five in bed.
    const short = trip([duty([leg(10 * H, 90)], 18.5 * H), duty([leg(19.5 * H, 90)])]);
    const s = tripBodyClockScore(short, MEM)!;
    expect(s.counts.shortSleeps).toBe(1);
    expect(s.factors.some((f) => f.id === "sleep")).toBe(true);
  });

  it("costs the body clock's moves, an advance (east) half again a delay (west)", () => {
    // Three days in a city six hours east, or west: the body moves about an hour a day east, an hour and a half west,
    // then back home. Out east the hard advance comes first; out west the body drifts further, and the advance is home.
    const away = (offset: number) => trip([duty([leg(10 * H, 5 * H, MEM, MEM + offset, "MEM", "XXX")], 82 * H), duty([leg(83 * H, 5 * H, MEM + offset, MEM, "XXX", "MEM")])]);
    const east = tripBodyClockScore(away(6 * H), MEM)!;
    const west = tripBodyClockScore(away(-6 * H), MEM)!;
    expect(east.counts.shiftHours).toBeGreaterThan(4);
    expect(west.counts.shiftHours).toBeGreaterThan(east.counts.shiftHours);
    const shift = (s: typeof east) => s.factors.find((f) => f.id === "shift")!.points;
    expect(shift(west)).toBeGreaterThan(shift(east));
  });

  it("counts overnight hotel standby at half a night's work, and not as time awake", () => {
    const flown = nightTrip(1);
    const onCall: Trip = { ...flown, id: "standby", schedule: flown.schedule.map((d) => ({ ...d, legs: d.legs.map((l) => ({ ...l, flightNumber: "STHOTL", isStandby: true })) })) };
    expect(tripBodyClockScore(onCall, MEM)!.score).toBeGreaterThan(tripBodyClockScore(flown, MEM)!.score);
  });

  it("is null for a trip it can't place on the clock", () => {
    expect(tripBodyClockScore({ ...dayTrip(), schedule: [] }, MEM)).toBeNull();
  });
});

describe("lineBodyClockScore", () => {
  it("costs too little recovery after a disruptive trip — more than the flip back to days it saves", () => {
    const close = lineBodyClockScore([nightTrip(3), { ...nightTrip(3), zuluAnchor: new Date(ZERO + 4 * 1440 * 60_000).toISOString(), startDayIndex: 4 }], MEM)!;
    const apart = lineBodyClockScore([nightTrip(3), { ...nightTrip(3), zuluAnchor: new Date(ZERO + 12 * 1440 * 60_000).toISOString(), startDayIndex: 12 }], MEM)!;
    expect(close.factors.some((f) => f.id === "recovery")).toBe(true);
    expect(apart.factors.some((f) => f.id === "recovery")).toBe(false);
    expect(close.score).toBeLessThan(apart.score);
    // The points lost, by reason, add up to 100 minus the score (give or take rounding).
    expect(Math.abs(close.factors.reduce((a, f) => a + f.points, 0) - (100 - close.score))).toBeLessThanOrEqual(close.factors.length);
  });

  it("reads like its trips: their scores averaged by days, when there's time to recover between them", () => {
    const day = dayTrip();
    const night = { ...nightTrip(3), zuluAnchor: new Date(ZERO + 10 * 1440 * 60_000).toISOString(), startDayIndex: 10 };
    const line = lineBodyClockScore([day, night], MEM)!;
    const d = tripBodyClockScore(day, MEM)!.score;
    const n = tripBodyClockScore(night, MEM)!.score;
    expect(line.score).toBe(Math.round((d * day.days + n * night.days) / (day.days + night.days)));
    expect(line.score).toBeLessThan(d);
    expect(line.score).toBeGreaterThan(n);
  });
});
