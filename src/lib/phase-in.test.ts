import { describe, expect, it } from "vitest";
import {
  NO_ELECTIONS,
  baseDayStartMinutes,
  dayIndices,
  dutyIsInternational,
  scheduledDutyLimitHours,
  tripBaseSpans,
  flownUnderInternationalRules,
  flyLine,
  flyPack,
  minimumDaysOff,
  phaseInRules,
  rDayConflictsWithEarlier,
  rDayConflictsWithLater,
  rDayConflictsWithRDay,
  recommendVipsAnswers,
  reservePeriodSpan,
  type CarryInItem,
  type CarryInTrip,
} from "@/lib/phase-in";
import { DateTime } from "luxon";
import type { BidPack, Line, Trip, TripDutyPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

const ZONE = "America/Chicago";
const HOUR = 3_600_000;

/** A trip reporting at 08:00 base time on its day, one duty per entry of `dutyHours`, with `restHours` between them. */
function trip(num: string, startDayIndex: number, opts: { tafb?: number; credit?: number; airports?: string[]; deadhead?: boolean; duties?: number[]; rest?: number; report?: string } = {}): Trip {
  const airports = opts.airports ?? ["MEM", "IND"];
  const dutyHours = opts.duties ?? [(opts.tafb ?? 10)];
  const rest = opts.rest ?? 12;
  let at = 0;
  const schedule: TripDutyPeriod[] = dutyHours.map((h, i) => {
    const start = at;
    const end = start + h * 60;
    at = end + rest * 60;
    return {
      reportTimeLocal: opts.report ?? "0800",
      startMinutes: start,
      legs: [
        {
          flightNumber: "1",
          equipment: "76",
          isDeadhead: !!opts.deadhead,
          depAirport: airports[0],
          depTimeLocal: "0900",
          depTimeGmt: "1500",
          arrAirport: airports[1],
          arrTimeLocal: "1100",
          arrTimeGmt: "1700",
          blockHours: 2,
          startMinutes: start + 60,
          endMinutes: end - 30,
          depTimeZulu: "",
          arrTimeZulu: "",
        },
      ],
      layover: i + 1 < dutyHours.length ? { city: airports[1], hotelName: null, transportToHotel: null, transportFromHotel: null, hours: rest, startMinutes: end, endMinutes: at } : null,
    };
  });
  const tafb = opts.tafb ?? dutyHours.reduce((a, h) => a + h, 0) + rest * (dutyHours.length - 1);
  return {
    id: `t-${num}`,
    pairingNumber: num,
    days: Math.max(1, Math.ceil(tafb / 24)),
    layoverCities: [],
    layoverDetails: [],
    reportTime: "early",
    international: false,
    deadheadLegs: 0,
    creditHours: opts.credit ?? 10,
    landings: dutyHours.length,
    tafbHours: tafb,
    departures: dutyHours.length,
    dutyPeriods: dutyHours.length,
    schedule,
    zuluAnchor: "",
    startDayIndex,
  };
}

function line(trips: Trip[], extras: Partial<Line> = {}): Line {
  const on = new Set(trips.flatMap((t) => Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i)));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return {
    id: "l-1",
    lineNumber: "1001",
    trips,
    daysOff: off.length,
    totalCreditHours: trips.reduce((a, t) => a + t.creditHours, 0),
    totalTafbHours: trips.reduce((a, t) => a + t.tafbHours, 0),
    totalLandings: trips.reduce((a, t) => a + t.landings, 0),
    totalDepartures: trips.reduce((a, t) => a + t.departures, 0),
    gridOffDays: off,
    ...extras,
  };
}

function pack(lines: Line[], month = "DEC26"): BidPack {
  return { id: "p", month, base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: month === "DEC26" ? "2026-11-30" : "2026-10-26", lines };
}

/** A carry-in that ends `hoursBeforeReport` before day 0's 08:00 report in `p`. */
function carryEndingBefore(p: BidPack, hoursBeforeReport: number, opts: Partial<CarryInTrip> & { tafb?: number } = {}): CarryInTrip {
  const report = DateTime.fromISO(`${p.bidPeriodStart}T08:00`, { zone: ZONE }).toMillis();
  const release = report - hoursBeforeReport * HOUR;
  const start = release - (opts.tafb ?? 48) * HOUR;
  return { kind: "trip", id: "c", label: "Trip 900", report: new Date(start).toISOString(), release: new Date(release).toISOString(), international: false, ...opts };
}

const fly = (p: BidPack, carry: CarryInItem[], elections = NO_ELECTIONS) => flyLine(p.lines[0], p, carry, elections);

describe("phaseInRules: switched by bid period (Implementation LOA, Phase 2 = December 2026)", () => {
  it("CBA 2026 12.C.6.a: domestic rest is 9 hours before December 2026, 9:30 from it", () => {
    expect(phaseInRules("NOV26").domesticRestMinutes).toBe(540);
    expect(phaseInRules("DEC26").domesticRestMinutes).toBe(570);
    expect(phaseInRules("JAN27").domesticRestMinutes).toBe(570);
  });
  it("CBA 2026 12.C.6.a: before an all-deadhead duty, 8 hours before December 2026, 8:30 from it", () => {
    expect(phaseInRules("NOV26").domesticDeadheadRestMinutes).toBe(480);
    expect(phaseInRules("DEC26").domesticDeadheadRestMinutes).toBe(510);
  });
  it("CBA 2026 25.L.6.e: make-up overage is 6 CH before December 2026, 7 from it", () => {
    expect(phaseInRules("NOV26").makeUpOverageCH).toBe(6);
    expect(phaseInRules("DEC26").makeUpOverageCH).toBe(7);
  });
  it("CBA 2026 25.E.1.a: the minimum-days-off election is all-in-one from December 2026", () => {
    expect(phaseInRules("NOV26").minDaysElectionAllInOne).toBe(false);
    expect(phaseInRules("DEC26").minDaysElectionAllInOne).toBe(true);
  });
});

describe("flownUnderInternationalRules (CBA 2026 12.D.1.a, 12.D.1.c.i)", () => {
  const on = (...airports: string[]) => flownUnderInternationalRules(trip("1", 0, { airports }));
  it("the 48 states are domestic", () => expect(on("MEM", "IND")).toBe(false));
  it("12.D.1.c.i: entirely within Alaska is domestic", () => expect(on("ANC", "ANC")).toBe(false));
  it("12.D.1.c.i: Canada, Mexico and Puerto Rico to the 48 are domestic", () => {
    expect(on("MEM", "YYZ")).toBe(false);
    expect(on("MEM", "MEX")).toBe(false);
    expect(on("MEM", "SJU")).toBe(false);
  });
  it("12.D.1.a: Hawaii and overseas are international", () => {
    expect(on("MEM", "HNL")).toBe(true);
    expect(on("ANC", "HKG")).toBe(true);
  });
  it("Alaska to the 48 stays international (question 8 for the ex-pilot)", () => expect(on("ANC", "MEM")).toBe(true));
});

describe("minimumDaysOff, from CBA 2026 25.D.1.b's work-day limits (unconfirmed: question 1)", () => {
  it("is what the most work days leave", () => {
    expect(minimumDaysOff(28)).toBe(13);
    expect(minimumDaysOff(35)).toBe(16);
    expect(minimumDaysOff(42)).toBe(19);
    expect(minimumDaysOff(30)).toBeNull();
  });
});

describe("R-day conflicts (CBA 2026 25.F.1.b.i–iii, every bid period)", () => {
  it("i: an R-day conflicts with an earlier assignment under 12 hours before its first RP", () => {
    expect(rDayConflictsWithEarlier(0, 11.9 * HOUR)).toBe(true);
    expect(rDayConflictsWithEarlier(0, 12 * HOUR)).toBe(false);
  });
  it("ii: an R-day conflicts with a later assignment under 12 hours after it ends", () => {
    expect(rDayConflictsWithLater(0, 11.9 * HOUR)).toBe(true);
    expect(rDayConflictsWithLater(0, 12 * HOUR)).toBe(false);
  });
  it("iii: R-days conflict under 12 hours between RPs, but not consecutive days with the same RP", () => {
    expect(rDayConflictsWithRDay(0, 6 * HOUR, false)).toBe(true);
    expect(rDayConflictsWithRDay(0, 12 * HOUR, false)).toBe(false);
    expect(rDayConflictsWithRDay(0, 6 * HOUR, true)).toBe(false);
  });
  it("25.M.2.a, 25.A.2: reserve periods start 0, 6, 12, 18 hours into the 0130 base day and last 12 (RP-24: 24)", () => {
    const at = (rp: "A" | "A+" | "B" | "B+" | "24") => {
      const s = reservePeriodSpan("2026-12-01", rp, ZONE);
      const day = DateTime.fromISO("2026-12-01T01:30", { zone: ZONE }).toMillis();
      return [(s.start - day) / HOUR, (s.end - s.start) / HOUR];
    };
    expect(at("A")).toEqual([0, 12]);
    expect(at("A+")).toEqual([6, 12]);
    expect(at("B")).toEqual([12, 12]);
    expect(at("B+")).toEqual([18, 12]);
    expect(at("24")).toEqual([0, 24]);
  });
});

describe("flyLine: a conflict drops the new trip (CBA 2026 25.F.3, 25.F.5)", () => {
  const dec = pack([line([trip("213", 0, { credit: 18.2 }), trip("214", 10)])]);

  it("25.F.3: a new trip overlapping the carry-in is dropped, without pay and make-up eligible for its CH value", () => {
    const f = fly(dec, [carryEndingBefore(dec, -3)]);
    expect(f.dropped.map((d) => d.trip.pairingNumber)).toEqual(["213"]);
    expect(f.dropped[0].findings[0].rule).toBe("overlap");
    expect(f.makeUpCH).toBeCloseTo(18.2);
    expect(f.line.trips.map((t) => t.pairingNumber)).toEqual(["214"]);
    expect(f.line.totalCreditHours).toBeCloseTo(10);
    expect(f.line.totalLandings).toBe(1);
    expect(f.reason).toContain("trip 213 (18.2 CH)");
    expect(f.reason).toContain("make-up eligible");
  });

  it("nothing carried in changes nothing", () => {
    const f = fly(dec, []);
    expect(f.dropped).toEqual([]);
    expect(f.line).toBe(dec.lines[0]);
    expect(f.reason).toBeNull();
  });

  it("a carry-in long done conflicts with nothing", () => {
    const f = fly(dec, [carryEndingBefore(dec, 72)]);
    expect(f.dropped).toEqual([]);
    expect(f.kept).toEqual([]);
  });

  it("12.C.6.a: from December 2026 under 9:30 of domestic rest is a question, not a drop: it could be one duty (12.C.4.e, 25.F.2)", () => {
    const under = fly(dec, [carryEndingBefore(dec, 9.25)]);
    expect(under.dropped).toEqual([]);
    expect(under.kept[0]).toMatchObject({ rule: "rest", certainty: "check" });
    expect(under.reason).toContain("legal only as one duty");
    expect(fly(dec, [carryEndingBefore(dec, 9.5)]).kept).toEqual([]);
  });

  it("12.C.6.a: before December 2026 the same 9:15 of rest needs no question", () => {
    const nov = pack([line([trip("213", 0)])], "NOV26");
    expect(fly(nov, [carryEndingBefore(nov, 9.25)]).kept).toEqual([]);
    expect(fly(nov, [carryEndingBefore(nov, 8.75)]).kept[0]?.rule).toBe("rest");
  });

  it("12.C.6.a: an all-deadhead next duty needs only 8:30 from December 2026", () => {
    const p = pack([line([trip("213", 0, { deadhead: true })])]);
    expect(fly(p, [carryEndingBefore(p, 8.75)]).kept).toEqual([]);
    expect(fly(p, [carryEndingBefore(p, 8.25)]).kept[0]?.rule).toBe("rest");
  });

  it("25.F.2, 12.C.4: a carry-in whose duties we know is fine as one duty inside the limit", () => {
    const p = pack([line([trip("213", 0, { tafb: 3 })])]);
    const release = DateTime.fromISO(`${p.bidPeriodStart}T08:00`, { zone: ZONE }).minus({ hours: 2 });
    const duty = { start: release.minus({ hours: 3 }).toUTC().toISO()!, end: release.toUTC().toISO()! };
    const carry: CarryInTrip = { kind: "trip", id: "c", label: "Trip 900", report: duty.start, release: duty.end, international: false, duties: [duty] };
    expect(fly(p, [carry])).toMatchObject({ dropped: [], kept: [] });
  });

  it("25.F.2, 12.C.4: past the longest limit as one duty it's a clear drop, even typed in", () => {
    const p = pack([line([trip("213", 0, { tafb: 17 })])]);
    expect(fly(p, [carryEndingBefore(p, 2)]).dropped[0]?.findings[0].rule).toBe("rest");
  });

  it("12.D.7.c: a known long international last duty needs 17 hours", () => {
    const p = pack([line([trip("213", 0)])]);
    const release = DateTime.fromISO(`${p.bidPeriodStart}T08:00`, { zone: ZONE }).minus({ hours: 13 });
    const duty = { start: release.minus({ hours: 14 }).toUTC().toISO()!, end: release.toUTC().toISO()! };
    const carry: CarryInTrip = { kind: "trip", id: "c", label: "Trip 900", report: duty.start, release: duty.end, international: true, duties: [duty], lastDutyBlockHours: 9 };
    expect(fly(p, [carry]).dropped[0]?.findings[0].section).toContain("12.D.7.c");
  });

  it("12.D.7.c: typed in, its last duty isn't known, so it's a question", () => {
    const p = pack([line([trip("213", 0)])]);
    const f = fly(p, [carryEndingBefore(p, 13, { international: true })]);
    expect(f.dropped).toEqual([]);
    expect(f.kept[0].section).toContain("12.D.7.c");
  });

  it("12.D.7.a, b: an international duty needs 12 hours before it, whichever side is international", () => {
    const p = pack([line([trip("213", 0, { airports: ["MEM", "HKG"] })])]);
    expect(fly(p, [carryEndingBefore(p, 11)]).dropped[0]?.findings[0].section).toContain("12.D.7");
    expect(fly(p, [carryEndingBefore(p, 12.5)]).dropped).toEqual([]);
    expect(fly(dec, [carryEndingBefore(dec, 11, { international: true })]).dropped[0]?.findings[0].section).toContain("12.D.7");
  });

  it("drops only what's left in the way: a trip is judged against the carry-in, not the trip dropped before it", () => {
    const p = pack([line([trip("213", 0), trip("214", 1)])]);
    const f = fly(p, [carryEndingBefore(p, -3)]);
    expect(f.dropped.map((d) => d.trip.pairingNumber)).toEqual(["213"]);
    expect(f.line.trips.map((t) => t.pairingNumber)).toEqual(["214"]);
  });

  it("25.A.5: days off are local base days: days carried in come off, a dropped trip's come back", () => {
    const p = pack([line([trip("213", 0), trip("214", 10)])]);
    const before = p.lines[0].daysOff;
    const f = fly(p, [carryEndingBefore(p, -3)]);
    // Day 0's trip is gone, but the carry-in lands on day 0, so the day isn't off.
    expect(f.daysOffAfter).toBe(before);
    expect(f.line.gridOffDays).not.toContain(0);

    const late = pack([line([trip("213", 2, { tafb: 10 }), trip("214", 10)])]);
    const carried = fly(late, [carryEndingBefore(late, -3)]);
    expect(carried.line.gridOffDays).not.toContain(0);
    expect(carried.daysOffAfter).toBe(late.lines[0].daysOff - 1);
    expect(carried.reason).toContain("takes 1 of its days off");
  });

  it("gives back a dropped trip's days and says so", () => {
    const report = trip("213", 1, { duties: [10, 10, 10], rest: 14 });
    const p = pack([line([report, trip("214", 12)])]);
    const start = DateTime.fromISO(`${p.bidPeriodStart}T08:00`, { zone: ZONE }).plus({ days: 1, hours: 2 }).toMillis();
    const carry: CarryInTrip = { kind: "trip", id: "c", label: "Trip 900", report: new Date(start - 60 * HOUR).toISOString(), release: new Date(start).toISOString(), international: false };
    const f = fly(p, [carry]);
    expect(f.dropped.map((d) => d.trip.pairingNumber)).toEqual(["213"]);
    expect(f.daysOffAfter).toBeGreaterThan(f.daysOffBefore);
    expect(f.reason).toMatch(/more days? off/);
  });

  it("a line whose trips aren't on dates isn't checked, and says so rather than guessing", () => {
    const p = pack([line([{ ...trip("213", 0), startDayIndex: null }], { gridOffDays: undefined, daysOff: 15 })]);
    const f = fly(p, [carryEndingBefore(p, -3)]);
    expect(f.unchecked).toBe(true);
    expect(f.line).toBe(p.lines[0]);
  });
});

describe("local base days (CBA 2026 25.A.2, 25.A.5)", () => {
  const p = { bidPeriodStart: "2026-11-30", bidPeriodDays: 28, base: "MEM" };
  const at = (s: string) => DateTime.fromISO(s, { zone: ZONE }).toMillis();
  it("25.A.2: a base day starts at 0130, so 00:58 still belongs to the day before", () => {
    expect(dayIndices({ start: at("2026-12-02T00:58"), end: at("2026-12-02T05:00") }, p)).toEqual([1, 2]);
    expect(dayIndices({ start: at("2026-12-02T01:30"), end: at("2026-12-02T05:00") }, p)).toEqual([2]);
  });
  it("a release at the stroke of the new base day doesn't touch it", () => {
    expect(dayIndices({ start: at("2026-12-02T08:00"), end: at("2026-12-03T01:30") }, p)).toEqual([2]);
  });
  it("25.A.2: EUR's base day starts at 0215", () => {
    expect(baseDayStartMinutes("Europe/Paris")).toBe(135);
    expect(baseDayStartMinutes("America/Chicago")).toBe(90);
  });
  it("stays inside the bid month", () => {
    expect(dayIndices({ start: at("2026-11-28T08:00"), end: at("2026-11-30T12:00") }, p)).toEqual([0]);
  });
});

describe("the international buffers (CBA 2026 12.D.1.d, 25.F.4)", () => {
  const longIntl = (num: string, day: number) => trip(num, day, { tafb: 130, airports: ["MEM", "HKG"] });
  const international = { international: true, tafb: 130 };
  const dec = pack([line([trip("213", 0), trip("214", 15)])]);

  it("12.D.1.d.ii: a new trip inside 48 hours after an international carry-in over 120 hours TAFB conflicts", () => {
    const f = fly(dec, [carryEndingBefore(dec, 30, international)]);
    expect(f.dropped[0]?.findings[0].rule).toBe("buffer-after");
    expect(f.dropped[0]?.findings[0].waivedBy).toBe("buffer");
  });
  it("12.D.1.d.ii: a carry-in of 120 hours or under has no buffer", () => {
    expect(fly(dec, [carryEndingBefore(dec, 30, { international: true, tafb: 120 })]).dropped).toEqual([]);
  });
  it("12.D.1.d.ii: 48 hours or more is clear", () => {
    expect(fly(dec, [carryEndingBefore(dec, 48, international)]).dropped).toEqual([]);
  });
  it("25.F.4: the waiver keeps the trip, and the line says why", () => {
    const f = fly(dec, [carryEndingBefore(dec, 30, international)], { ...NO_ELECTIONS, waiveBufferPhaseIn: true });
    expect(f.dropped).toEqual([]);
    expect(f.kept[0].waived).toBe(true);
    expect(f.reason).toContain("waived the international buffer");
  });
  it("a waiver can't buy back legal rest (12.D.7): rest still drops the trip", () => {
    const f = fly(dec, [carryEndingBefore(dec, 11, international)], { ...NO_ELECTIONS, waiveBufferPhaseIn: true });
    expect(f.dropped[0]?.findings[0].rule).toBe("rest");
  });
  it("12.D.1.d.i: inside 24 hours before a new international trip over 120 hours TAFB conflicts, waivable", () => {
    const p = pack([line([longIntl("300", 0), trip("214", 15)])]);
    const f = fly(p, [carryEndingBefore(p, 20)]);
    expect(f.dropped[0]?.findings[0].rule).toBe("buffer-before");
    expect(fly(p, [carryEndingBefore(p, 24)]).dropped).toEqual([]);
    expect(fly(p, [carryEndingBefore(p, 20)], { ...NO_ELECTIONS, waiveBufferPhaseIn: true }).dropped).toEqual([]);
  });
  it("12.D.1.d.i: a trip of domestic parameters (12.D.1.c.i) has no front-end buffer", () => {
    const p = pack([line([trip("300", 0, { tafb: 130, airports: ["MEM", "YYZ"] }), trip("214", 15)])]);
    expect(fly(p, [carryEndingBefore(p, 20)]).dropped).toEqual([]);
  });
  it("12.D.1.d.i: reserve is allowed inside the 24 hours, so R-days don't break the front-end buffer", () => {
    const p = pack([line([longIntl("300", 1), trip("214", 15)])]);
    const rdays: CarryInItem = { kind: "rdays", id: "r", label: "your R-days", firstDay: "2026-11-30", days: 1, rp: "A" };
    expect(fly(p, [rdays]).dropped).toEqual([]);
  });
});

describe("carried-in R-days against a new trip (CBA 2026 25.F.1.b.ii)", () => {
  // Day 0 is Nov 30. An RP-A R-day on Nov 29 ends at 13:30 on Nov 29, and its base day at 01:30 on Nov 30.
  const r = (rp: "A" | "24", firstDay = "2026-11-29", days = 1): CarryInItem => ({ kind: "rdays", id: "r", label: "your R-days", firstDay, days, rp });

  it("under 12 hours after the R-day ends conflicts", () => {
    const p = pack([line([trip("213", 0, { report: "0800" })])]);
    expect(fly(p, [r("24", "2026-11-29")]).dropped[0]?.findings[0].rule).toBe("r-day");
  });
  it("a new trip during the R-day conflicts", () => {
    const p = pack([line([trip("213", 0)])]);
    expect(fly(p, [r("24", "2026-11-30")]).dropped[0]?.findings[0].rule).toBe("overlap");
  });
  it("12 hours past the RP but under 12 past the calendar day is a question, not a drop (question 7)", () => {
    const p = pack([line([trip("213", 0)])]);
    const f = fly(p, [r("A")]);
    expect(f.dropped).toEqual([]);
    expect(f.kept[0].certainty).toBe("check");
    expect(f.reason).toContain("Check trip 213");
  });
  it("12 hours past both is clear", () => {
    const p = pack([line([trip("213", 1)])]);
    expect(fly(p, [r("24")])).toMatchObject({ dropped: [], kept: [] });
  });
});

describe("1-in-7 across the month change (CBA 2026 12.C.1.b, 12.D.1.i)", () => {
  // Four known duties with 12 hours between, each 12 long: the carry-in works 84 hours and ends 10 hours before day 0's 08:00.
  function knownCarry(p: BidPack, hoursBefore = 10): CarryInTrip {
    const release = DateTime.fromISO(`${p.bidPeriodStart}T08:00`, { zone: ZONE }).toMillis() - hoursBefore * HOUR;
    const duties = [3, 2, 1, 0].map((n) => ({ start: new Date(release - n * 24 * HOUR - 12 * HOUR).toISOString(), end: new Date(release - n * 24 * HOUR).toISOString() }));
    return { kind: "trip", id: "c", label: "Trip 900", report: duties[0].start, release: duties[3].end, international: false, duties };
  }

  it("past 144 hours with no 24 hours off, the first trip to break it is dropped (question 2)", () => {
    const p = pack([line([trip("213", 0, { duties: [10, 10, 10, 10], rest: 14 })])]);
    const f = fly(p, [knownCarry(p)]);
    expect(f.dropped[0]?.findings.map((x) => x.rule)).toContain("one-in-7");
    expect(f.dropped[0]?.findings[0].certainty).toBe("clear");
  });
  it("between 120 and 144 hours is fine: the October lines reach 144 and never pass it (question 21)", () => {
    const p = pack([line([trip("213", 0, { duties: [10, 10], rest: 14 })])]);
    const f = fly(p, [knownCarry(p)]);
    expect(f.dropped).toEqual([]);
    expect(f.kept.map((x) => x.rule)).not.toContain("one-in-7");
  });
  it("a 24-hour layover inside the new trip is the relief", () => {
    const p = pack([line([trip("213", 0, { duties: [10, 10, 10], rest: 30 })])]);
    const f = fly(p, [knownCarry(p)]);
    expect(f.dropped).toEqual([]);
    expect(f.kept).toEqual([]);
  });
  it("a typed carry-in's layovers aren't known, so it's a question at most", () => {
    const p = pack([line([trip("213", 0, { duties: [10, 10, 10, 10], rest: 14 })])]);
    const f = fly(p, [carryEndingBefore(p, 10, { tafb: 84 })]);
    expect(f.dropped).toEqual([]);
    expect(f.kept.map((x) => x.rule)).toContain("one-in-7");
    expect(f.reason).toContain("unless your carry-in has a layover that long");
  });
  it("24 hours off before the new trip resets it", () => {
    const p = pack([line([trip("213", 1, { duties: [10, 10, 10, 10], rest: 14 })])]);
    expect(fly(p, [knownCarry(p, 10)]).kept).toEqual([]);
  });
});

describe("1-in-10 across the month change (CBA 2026 12.C.1.c, 25.E.1.d)", () => {
  // A 7-day domestic carry-in, ending 10 hours before day 0's 08:00.
  const domestic = (p: BidPack) => carryEndingBefore(p, 10, { tafb: 168 });
  const long = (num: string, day: number) => trip(num, day, { duties: [10, 10, 10, 10], rest: 30 });

  it("past 216 hours with no 24 hours at base, the trip is dropped unless waived", () => {
    const p = pack([line([long("213", 0)])]);
    const ten = fly(p, [domestic(p)]);
    const finding = ten.dropped[0]?.findings.find((x) => x.rule === "one-in-10");
    expect(finding?.waivedBy).toBe("1-in-10");
    const waived = fly(p, [domestic(p)], { ...NO_ELECTIONS, waive1in10: true });
    expect(waived.dropped).toEqual([]);
    expect(waived.kept.find((x) => x.rule === "one-in-10")?.waived).toBe(true);
  });
  it("12.C.1.c: only for a period of exclusively domestic trips: an international trip in it ends the rule", () => {
    const p = pack([line([long("213", 0)])]);
    const f = fly(p, [carryEndingBefore(p, 10, { tafb: 168, international: true })]);
    expect(f.dropped.flatMap((d) => d.findings).map((x) => x.rule)).not.toContain("one-in-10");
    expect(f.kept.map((x) => x.rule)).not.toContain("one-in-10");
  });
});

describe("duty-level rules (CBA 2026 12.D.1.a, 12.C.4)", () => {
  it("12.D.1.a: an Asian trip's last leg into Canada or the 48 from outside is an international duty", () => {
    const t = trip("1", 0, { airports: ["YVR", "MEM"] });
    expect(dutyIsInternational({ ...t, schedule: [...trip("2", 0, { airports: ["MEM", "HKG"] }).schedule, ...t.schedule] }, t.schedule[0])).toBe(true);
  });
  it("12.D.1.a: a duty inside the 48 isn't, on any trip", () => {
    const home = trip("1", 0, { airports: ["IND", "MEM"] });
    expect(dutyIsInternational({ ...home, schedule: [...trip("2", 0, { airports: ["MEM", "HKG"] }).schedule, ...home.schedule] }, home.schedule[0])).toBe(false);
  });
  it("12.C.4.a-d: 13 day, 11:30 night, 9 critical, with the blends", () => {
    expect(scheduledDutyLimitHours(600)).toBe(13);
    expect(scheduledDutyLimitHours(1200)).toBe(11.5);
    expect(scheduledDutyLimitHours(120)).toBe(9);
    expect(scheduledDutyLimitHours(315)).toBe(12);
    expect(scheduledDutyLimitHours(960)).toBe(12.25);
    expect(scheduledDutyLimitHours(1425)).toBe(10.25);
    expect(scheduledDutyLimitHours(30)).toBe(9.5);
  });
  it("12.C.1.c: 24 hours at base inside a trip is relief", () => {
    const t = trip("1", 0, { airports: ["MEM", "MEM"], duties: [10, 10], rest: 30 });
    t.schedule[0].layover!.city = "MEM";
    expect(tripBaseSpans(t, 0, "MEM")).toHaveLength(2);
    expect(tripBaseSpans(t, 0, "IND")).toHaveLength(1);
  });
  it("12.D.1.d.i: before December 2026 the 24-hour buffer has no domestic-parameters exception (Phase 2)", () => {
    const t = (m: "NOV26" | "DEC26") => pack([line([trip("300", 0, { tafb: 130, airports: ["MEM", "YYZ"] })])], m);
    expect(fly(t("NOV26"), [carryEndingBefore(t("NOV26"), 20)]).dropped[0]?.findings[0].rule).toBe("buffer-before");
    expect(fly(t("DEC26"), [carryEndingBefore(t("DEC26"), 20)]).dropped).toEqual([]);
  });
});

describe("25.F.3.a: drop the carryover instead (every bid period)", () => {
  it("advises it when a new trip over 120 hours TAFB collides with a carryover under 72", () => {
    const p = pack([line([trip("300", 0, { tafb: 130 }), trip("214", 15)])]);
    const f = fly(p, [carryEndingBefore(p, -2, { tafb: 48 })]);
    expect(f.advice.join(" ")).toContain("25.F.3.a");
    expect(f.advice.join(" ")).toContain("Trip 900");
  });
  it("doesn't when the carryover is 72 hours or more", () => {
    const p = pack([line([trip("300", 0, { tafb: 130 })])]);
    expect(fly(p, [carryEndingBefore(p, -2, { tafb: 72 })]).advice.join(" ")).not.toContain("25.F.3.a");
  });
  it("doesn't when the new trip is 120 hours or under", () => {
    const p = pack([line([trip("300", 0, { tafb: 120 })])]);
    expect(fly(p, [carryEndingBefore(p, -2, { tafb: 48 })]).advice.join(" ")).not.toContain("25.F.3.a");
  });
  it("names only the carry-in in the way, \"to avoid a phase-in conflict\"", () => {
    const p = pack([line([trip("300", 0, { tafb: 130 })])]);
    const inWay = carryEndingBefore(p, -2, { tafb: 80, id: "a", label: "Trip 901" });
    const earlier = carryEndingBefore(p, 200, { tafb: 48, id: "b", label: "Trip 902" });
    expect(fly(p, [earlier, inWay]).advice.join(" ")).not.toContain("Trip 902");
  });
  it("counts a carried-in R-day block under 3 days", () => {
    const p = pack([line([trip("300", 0, { tafb: 130 })])]);
    const r: CarryInItem = { kind: "rdays", id: "r", label: "your R-days", firstDay: "2026-11-30", days: 2, rp: "24" };
    expect(fly(p, [r]).advice.join(" ")).toContain("25.F.3.a");
  });
});

describe("minimum days off after carry-in (CBA 2026 25.F.7)", () => {
  // 13 days off is the floor for 28 days. A long line with 13 off and a carry-in that takes one.
  function atMinimum(): BidPack {
    const trips = [trip("1", 1, { credit: 20, tafb: 100 }), trip("2", 8, { credit: 12, tafb: 60 }), trip("3", 14, { credit: 25, tafb: 96 })];
    const off = [0, 6, 7, 11, 12, 13, 19, 20, 21, 22, 23, 26, 27];
    return pack([{ ...line(trips), daysOff: off.length, gridOffDays: off }]);
  }
  it("flags a line the carry-in leaves under the minimum, and lists drops, least CH first", () => {
    const p = atMinimum();
    const f = fly(p, [carryEndingBefore(p, -2)]);
    expect(f.minDays?.needed).toBe(13);
    expect(f.minDays?.have).toBe(12);
    expect(f.minDays?.options[0].pairingNumbers).toEqual(["2"]);
    expect(f.advice.join(" ")).toContain("minimum days off protection");
  });
  it("25.F.7.b: a drop that passes the minimum is marked so", () => {
    const p = atMinimum();
    const f = fly(p, [carryEndingBefore(p, -2)]);
    expect(f.minDays?.options.every((o) => o.section === "25.F.7.b" || o.daysOffAfter === 13)).toBe(true);
  });
  it("advises only: the minimum isn't confirmed, so no trip is dropped for it", () => {
    const p = atMinimum();
    expect(fly(p, [carryEndingBefore(p, -2)], { ...NO_ELECTIONS, protectMinDays: true }).dropped).toEqual([]);
  });
});

describe("flyPack", () => {
  it("returns the same pack with nothing carried in", () => {
    const p = pack([line([trip("213", 0)])]);
    expect(flyPack(p, [], NO_ELECTIONS).pack).toBe(p);
  });
  it("keeps line ids, for the ranking to find them", () => {
    const p = pack([line([trip("213", 0)])]);
    const flown = flyPack(p, [carryEndingBefore(p, -3)], NO_ELECTIONS);
    expect(flown.pack.lines[0].id).toBe("l-1");
    expect(flown.pack.lines[0].trips).toEqual([]);
    expect(flown.lines.get("l-1")?.dropped.length).toBe(1);
  });
});

describe("recommendVipsAnswers", () => {
  const model = (metric: string, shape: PilotModel["criteria"][number]["shape"]): PilotModel => ({ criteria: [{ id: "c", label: "x", metric, weight: 1, shape, tier: "major", confidence: 1 }] }) as unknown as PilotModel;
  const p = pack([
    { ...line([trip("1", 0, { credit: 40 }), trip("2", 10, { credit: 40 })]), id: "a", lineNumber: "1001" },
    { ...line([trip("3", 6, { credit: 50 }), trip("4", 12, { credit: 30 })]), id: "b", lineNumber: "1002" },
  ]);
  const intl = carryEndingBefore(p, 30, { international: true, tafb: 130 });
  const byKey = (r: ReturnType<typeof recommendVipsAnswers>) => Object.fromEntries(r.map((x) => [x.key, x]));

  it("answers all four questions, with a reason and section each, and recurrent stays the pilot's call", () => {
    const r = recommendVipsAnswers({ pack: p, order: ["1001", "1002"], carryIn: [intl], model: null });
    expect(r.map((x) => x.key)).toEqual(["waiveBufferRecurrent", "waiveBufferPhaseIn", "waive1in10", "protectMinDays"]);
    for (const x of r) {
      expect(x.reason.length).toBeGreaterThan(0);
      expect(x.section).toContain("CBA 2026");
    }
    expect(byKey(r).waiveBufferRecurrent.answer).toBeNull();
  });
  it("no carry-in: no phase-in conflict to waive", () => {
    const r = byKey(recommendVipsAnswers({ pack: p, order: ["1001"], carryIn: [], model: null }));
    expect(r.waiveBufferPhaseIn.answer).toBe(false);
    expect(r.waive1in10.answer).toBe(false);
    expect(r.waiveBufferPhaseIn.reason).toContain("No carry-in");
  });
  it("no affected top line: no waiver needed, whatever the pack's other lines do", () => {
    const r = byKey(recommendVipsAnswers({ pack: p, order: ["1002"], carryIn: [intl], model: null }));
    expect(r.waiveBufferPhaseIn.answer).toBe(false);
    expect(r.waiveBufferPhaseIn.reason).toContain("None of your top 1 lines");
  });
  it("without the pilot's priorities, a waiver that changes things is the pilot's call", () => {
    const r = byKey(recommendVipsAnswers({ pack: p, order: ["1001"], carryIn: [intl], model: null }));
    expect(r.waiveBufferPhaseIn.answer).toBeNull();
  });
  it("weighs it with the pilot's own model: credit says keep the trip, days off says lose it", () => {
    const credit = byKey(recommendVipsAnswers({ pack: p, order: ["1001"], carryIn: [intl], model: model("creditHours", { kind: "more" }) }));
    const off = byKey(recommendVipsAnswers({ pack: p, order: ["1001"], carryIn: [intl], model: model("daysOff", { kind: "more" }) }));
    expect(credit.waiveBufferPhaseIn.answer).toBe(true);
    expect(off.waiveBufferPhaseIn.answer).toBe(false);
  });
  it("recommends minimum days off protection when the carry-in puts a top line under the minimum", () => {
    const trips = [trip("1", 1, { credit: 20, tafb: 100 }), trip("2", 8, { credit: 12, tafb: 60 }), trip("3", 14, { credit: 25, tafb: 96 })];
    const off = [0, 6, 7, 11, 12, 13, 19, 20, 21, 22, 23, 26, 27];
    const q = pack([{ ...line(trips), lineNumber: "1001", daysOff: off.length, gridOffDays: off }]);
    const r = byKey(recommendVipsAnswers({ pack: q, order: ["1001"], carryIn: [carryEndingBefore(q, -2)], model: null }));
    expect(r.protectMinDays.answer).toBe(true);
    expect(r.protectMinDays.section).toContain("25.F.7");
  });
});
