import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { NO_ELECTIONS, type CarryInTrip } from "@/lib/phase-in";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import { flySchedule, flyVacations, flyVacationsOnLine, pilotVacations, rankedAsFlown, vacationId, withChoices, type VacationChoice } from "@/lib/vacation-lines";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

const ZONE = "America/Chicago";

function trip(num: string, startDayIndex: number, opts: { tafb?: number; credit?: number } = {}): Trip {
  const tafb = opts.tafb ?? 40;
  return {
    id: `t-${num}`,
    pairingNumber: num,
    days: Math.max(1, Math.ceil((tafb + 8) / 24)),
    layoverCities: [],
    layoverDetails: [],
    reportTime: "early",
    international: false,
    deadheadLegs: 0,
    creditHours: opts.credit ?? 15,
    landings: 1,
    tafbHours: tafb,
    departures: 1,
    dutyPeriods: 1,
    schedule: [{ reportTimeLocal: "0800", startMinutes: 0, legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "0900", depTimeGmt: "1400", arrAirport: "IND", arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 2, startMinutes: 60, endMinutes: tafb * 60, depTimeZulu: "", arrTimeZulu: "" }], layover: null }],
    zuluAnchor: "",
    startDayIndex,
  };
}

function line(trips: Trip[], lineNumber = "1001"): Line {
  const on = new Set(trips.flatMap((t) => Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i)));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return { id: `l-${lineNumber}`, lineNumber, trips, daysOff: off.length, totalCreditHours: trips.reduce((a, t) => a + t.creditHours, 0), totalTafbHours: trips.reduce((a, t) => a + t.tafbHours, 0), totalLandings: trips.length, totalDepartures: trips.length, gridOffDays: off };
}

const START = "2026-09-28";

function pack(lines: Line[], extras: Partial<BidPack> = {}): BidPack {
  return { id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: START, lines, ...extras };
}

function vac(dayIndex: number, days = 7): VacationPeriod {
  const from = DateTime.fromISO(`${START}T01:30`, { zone: ZONE }).plus({ days: dayIndex });
  return { from: from.toUTC().toISO()!, to: from.plus({ days }).minus({ minutes: 1 }).toUTC().toISO()!, days };
}

const on = (vacation: VacationPeriod, choice: VacationChoice = "use") => ({ vacation, choice });

describe("a vacation on a line (CBA 2026 7.G.1, every bid period)", () => {
  const hit = trip("213", 10, { credit: 18.2 });
  const kept = trip("300", 20);
  const l = line([hit, kept]);
  const p = pack([l]);

  it("7.G.1: the trip in conflict comes off, its pay stays, and its days and the vacation's are off", () => {
    const f = flyVacationsOnLine(l, p, [on(vac(9))]);
    expect(f.line.trips.map((t) => t.pairingNumber)).toEqual(["300"]);
    expect(f.line.totalCreditHours).toBe(l.totalCreditHours);
    expect(f.chargedCH).toBeCloseTo(18.2);
    expect(f.daysOffAfter).toBeGreaterThan(f.daysOffBefore);
    expect(f.line.gridOffDays).toEqual(expect.arrayContaining([9, 10, 11, 12, 13, 14, 15]));
    expect(f.reason).toContain("trip 213 (18.2 CH)");
    expect(f.reason).toContain("paid from your bank");
  });
  it("7.G.1: the bank is charged only for removed trips, so one on days off costs nothing, and says so", () => {
    const f = flyVacationsOnLine(l, p, [on(vac(0, 5))]);
    expect(f.removed).toEqual([]);
    expect(f.chargedCH).toBe(0);
    expect(f.reason).toContain("your bank isn't charged");
  });
  it("7.A.1: says when the trips draw more than the vacation's own value, 6 CH a day", () => {
    const heavy = line([trip("900", 10, { credit: 60 })]);
    const f = flyVacationsOnLine(heavy, pack([heavy]), [on(vac(9))]);
    expect(f.overCH).toBeCloseTo(18);
    expect(f.reason).toContain("18.0 CH more than this vacation's 42 CH");
  });
  it("keep-flying: the trip still comes off, but its pay isn't counted, and the share of credit it takes is kept", () => {
    const f = flyVacationsOnLine(l, p, [on(vac(9), "keep-flying")]);
    expect(f.line.trips.map((t) => t.pairingNumber)).toEqual(["300"]);
    expect(f.line.totalCreditHours).toBeCloseTo(l.totalCreditHours - 18.2);
    expect(f.keepFlyingLoss).toBeCloseTo(18.2 / l.totalCreditHours);
    expect(f.reason).toContain("ranks lower");
  });
  it("use: nothing marked down", () => {
    expect(flyVacationsOnLine(l, p, [on(vac(9))]).keepFlyingLoss).toBe(0);
  });
  it("not-taking: the line stays exactly as printed", () => {
    const f = flyVacationsOnLine(l, p, [on(vac(9), "not-taking")]);
    expect(f.line).toBe(l);
    expect(f.reason).toBeNull();
  });
  it("two vacations both count, each by its own choice", () => {
    const f = flyVacationsOnLine(l, p, [on(vac(9)), on(vac(19, 5), "keep-flying")]);
    expect(f.line.trips).toEqual([]);
    expect(f.line.totalCreditHours).toBeCloseTo(18.2);
  });
  it("a line whose trips aren't on dates is left alone, and marked", () => {
    const undated = line([trip("1", 0)]);
    undated.trips[0] = { ...undated.trips[0], startDayIndex: null };
    const f = flyVacationsOnLine(undated, p, [on(vac(0))]);
    expect(f.unchecked).toBe(true);
    expect(f.line).toBe(undated);
  });
});

describe("flySchedule", () => {
  const l = line([trip("213", 0), trip("300", 12)]);
  const p = pack([l]);
  const report = DateTime.fromISO(`${START}T08:00`, { zone: ZONE });
  const carry: CarryInTrip = { kind: "trip", id: "c", label: "Trip 900", report: report.minus({ hours: 40 }).toUTC().toISO()!, release: report.plus({ hours: 2 }).toUTC().toISO()!, international: false };

  it("no vacation in play and no carry-in: the very same pack, so the ranking can't move", () => {
    expect(flySchedule(p, { items: [], elections: NO_ELECTIONS }, []).pack).toBe(p);
    expect(flySchedule(p, { items: [], elections: NO_ELECTIONS }, [on(vac(9), "not-taking")]).pack).toBe(p);
  });
  it("applies carry-in first, then the vacation over what's left", () => {
    const f = flySchedule(p, { items: [carry], elections: NO_ELECTIONS }, [on(vac(11))]);
    expect(f.lines.get(l.id)?.dropped.map((d) => d.trip.pairingNumber)).toEqual(["213"]);
    expect(f.vacationLines.get(l.id)?.removed.map((r) => r.trip.pairingNumber)).toEqual(["300"]);
    expect(f.pack.lines[0].trips).toEqual([]);
  });
  it("a vacation can't free a day a carry-in is still flying", () => {
    const f = flySchedule(p, { items: [carry], elections: NO_ELECTIONS }, [on(vac(0, 3))]);
    expect(f.pack.lines[0].gridOffDays).not.toContain(0);
    expect(f.pack.lines[0].gridOffDays).toContain(1);
  });
  it("keeps line ids, for the ranking to find them", () => {
    expect(flyVacations(p, [on(vac(11))]).pack.lines[0].id).toBe(l.id);
  });
});

describe("the choices move the ranking", () => {
  const model = { criteria: [{ id: "c", label: "credit", metric: "creditHours", weight: 1, shape: { kind: "more" }, tier: "major", confidence: 1 }] } as unknown as PilotModel;
  // Equal credit as printed: the vacation lands on A's trips, and on B's days off.
  const a = line([trip("1", 10, { credit: 40 })], "1001");
  const b = line([trip("2", 20, { credit: 40 })], "1002");
  const p = pack([a, b]);
  const order = (choice: VacationChoice) => rankPackV2(flyVacations(p, [on(vac(9), choice)]).pack, model).map((s) => [s.lineNumber, s.score]);

  it("use: the pay stays, so they tie on credit", () => {
    const [x, y] = order("use");
    expect(x[1]).toBe(y[1]);
  });
  it("keep-flying: the line the vacation misses rises", () => {
    expect(order("keep-flying")[0][0]).toBe("1002");
  });
  it("keep-flying: marks a line down by the share of credit taken, whatever the pilot's priorities weigh", () => {
    const f = flySchedule(p, { items: [], elections: NO_ELECTIONS }, [on(vac(9), "keep-flying")]);
    const scored = [
      { line: f.pack.lines[0], score: 60 },
      { line: f.pack.lines[1], score: 50 },
    ];
    expect(rankedAsFlown(scored, p, f).map((s) => [s.line.lineNumber, s.score])).toEqual([["1002", 50], ["1001", 0]]);
  });
  it("hands back the printed line, for the list to draw", () => {
    const f = flySchedule(p, { items: [], elections: NO_ELECTIONS }, [on(vac(9))]);
    const scored = f.pack.lines.map((line) => ({ line, score: 50 }));
    expect(rankedAsFlown(scored, p, f).map((s) => s.line)).toEqual([a, b]);
  });
  it("the same ranking as today when no vacation is in play", () => {
    const f = flySchedule(p, { items: [], elections: NO_ELECTIONS }, []);
    const scored = p.lines.map((line, i) => ({ line, score: 50 - i }));
    expect(rankedAsFlown(scored, p, f)).toBe(scored);
  });
});

describe("pilotVacations", () => {
  const list = [
    { bidNumber: 1, seniority: 100, vacations: [vac(9), vac(70)] },
    { bidNumber: 2, seniority: 200 },
  ];
  const p = pack([], { seniorityList: list });
  it("finds them by seniority number, only those this month can feel", () => {
    const v = pilotVacations(p, { seniorityNumber: 100 }, null);
    expect(v.known).toBe(true);
    expect(v.vacations).toEqual([list[0].vacations![0]]);
  });
  it("12.D.1.d: one just after the month still counts: a trip's 48-hour buffer can reach it", () => {
    const q = pack([], { seniorityList: [{ bidNumber: 1, seniority: 100, vacations: [vac(29)] }] });
    expect(pilotVacations(q, { seniorityNumber: 100 }, null).vacations).toHaveLength(1);
  });
  it("7.G.1: next month's vacation still takes off a trip that runs into it", () => {
    const carrying = line([trip("1", 26, { tafb: 90 })]);
    const v = vac(29);
    const q = pack([carrying], { seniorityList: [{ bidNumber: 1, seniority: 100, vacations: [v] }] });
    expect(pilotVacations(q, { seniorityNumber: 100 }, null).vacations).toEqual([v]);
    expect(flyVacationsOnLine(carrying, q, [on(v)]).removed).toHaveLength(1);
  });
  it("a pilot with none has none", () => {
    expect(pilotVacations(p, { seniorityNumber: 200 }, null)).toMatchObject({ known: true, vacations: [] });
  });
  it("says when it can't tell who the pilot is", () => {
    expect(pilotVacations(p, { seniorityNumber: null }, null)).toMatchObject({ known: false, packHasSchedule: true, vacations: [] });
  });
  it("says when the pack has no schedule", () => {
    expect(pilotVacations(pack([]), { seniorityNumber: 100 }, null).packHasSchedule).toBe(false);
  });
});

describe("withChoices", () => {
  it("is use until the pilot says otherwise", () => {
    const v = vac(9);
    expect(withChoices([v], undefined)[0].choice).toBe("use");
    expect(withChoices([v], { [vacationId(v)]: "not-taking" })[0].choice).toBe("not-taking");
  });
});
