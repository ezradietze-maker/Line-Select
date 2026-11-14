import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  CH_PER_VACATION_DAY,
  MAX_SLIDE_DAYS,
  chargedToBank,
  findVacationSlides,
  frontBufferWaivable,
  slideChecks,
  slideWhere,
  typedVacation,
  vacationRemovals,
  vacationsInReach,
} from "@/lib/vacation-slide";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

const ZONE = "America/Chicago";

function trip(num: string, startDayIndex: number, opts: { tafb?: number; credit?: number; airports?: string[] } = {}): Trip {
  const tafb = opts.tafb ?? 40;
  const airports = opts.airports ?? ["MEM", "IND"];
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
    schedule: [
      {
        reportTimeLocal: "0800",
        startMinutes: 0,
        legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: airports[0], depTimeLocal: "0900", depTimeGmt: "1500", arrAirport: airports[1], arrTimeLocal: "1100", arrTimeGmt: "1700", blockHours: 2, startMinutes: 60, endMinutes: tafb * 60, depTimeZulu: "", arrTimeZulu: "" }],
        layover: null,
      },
    ],
    zuluAnchor: "",
    startDayIndex,
  };
}

function line(trips: Trip[], lineNumber = "1001"): Line {
  const on = new Set(trips.flatMap((t) => Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i)));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return { id: `l-${lineNumber}`, lineNumber, trips, daysOff: off.length, totalCreditHours: trips.reduce((a, t) => a + t.creditHours, 0), totalTafbHours: trips.reduce((a, t) => a + t.tafbHours, 0), totalLandings: trips.length, totalDepartures: trips.length, gridOffDays: off };
}

const START: Record<string, string> = { OCT26: "2026-09-28", NOV26: "2026-10-26", DEC26: "2026-11-30", JAN27: "2026-12-28", FEB27: "2027-01-25" };

function pack(lines: Line[], month = "OCT26"): BidPack {
  return { id: "p", month, base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: START[month], lines };
}

/** A vacation of `days` base days from `dayIndex` days into `month`, 0130 to 0129 like the pack prints it. */
function vac(dayIndex: number, days = 7, month = "OCT26"): VacationPeriod {
  const from = DateTime.fromISO(`${START[month]}T01:30`, { zone: ZONE }).plus({ days: dayIndex });
  return { from: from.toUTC().toISO()!, to: from.plus({ days }).minus({ minutes: 1 }).toUTC().toISO()!, days };
}

describe("slideChecks (CBA 2026 7.E.2.a, every bid period)", () => {
  const legal = (v: VacationPeriod, p: BidPack) => slideChecks(v, p).filter((c) => c.legal).map((c) => c.offset);

  it("7.E.2.a: up to 5 days either way, in whole days", () => {
    expect(MAX_SLIDE_DAYS).toBe(5);
    expect(legal(vac(10), pack([]))).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  });
  it("7.E.2.a: a slide before this bid month belonged in last month's window", () => {
    const checks = slideChecks(vac(2), pack([]));
    expect(checks.filter((c) => c.legal).map((c) => c.offset)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5]);
    expect(checks.find((c) => c.offset === -3)?.why).toContain("7.E.2.a");
  });
  it("7.E.2.a: next month's vacation can slide back into this month: \"a vacation in the first week of February may be slid back into January\"", () => {
    const jan = pack([], "JAN27");
    expect(legal(vac(0, 7, "FEB27"), jan)).toEqual([-5, -4, -3, -2, -1, 0]);
  });
  it("7.E.2.a: \"A vacation in the first week of January may not be slid back into December\"", () => {
    const dec = pack([], "DEC26");
    const checks = slideChecks(vac(0, 7, "JAN27"), dec);
    expect(checks.filter((c) => c.legal).map((c) => c.offset)).toEqual([0]);
    expect(checks.find((c) => c.offset === -1)?.why).toContain("November or December");
  });
  it("7.E.2.a: nor back into November", () => {
    expect(legal(vac(0, 7, "DEC26"), pack([], "NOV26"))).toEqual([0]);
  });
  it("7.E.2.a: a slide that leaves this bid month isn't this window's", () => {
    const checks = slideChecks(vac(26, 1), pack([]));
    expect(checks.find((c) => c.offset === 2)?.legal).toBe(false);
    expect(checks.find((c) => c.offset === 1)?.legal).toBe(true);
  });
  it("a pack without dates has nothing to slide against, and says so", () => {
    const p = { ...pack([]), bidPeriodStart: null };
    expect(slideChecks(vac(10), p).every((c) => !c.legal)).toBe(true);
  });
});

describe("vacationRemovals (CBA 2026 7.G.1, 7.E.2.c, 12.D.1.d)", () => {
  const spanOf = (v: VacationPeriod) => ({ start: Date.parse(v.from), end: Date.parse(v.to) });
  const rules = (t: Trip, v: VacationPeriod, slid = false, p = pack([])) => vacationRemovals(line([t]), p, spanOf(v), { slid }).map((r) => r.rule);

  it("7.G.1: a trip in the vacation comes off, even by a little", () => {
    expect(rules(trip("1", 10), vac(10))).toEqual(["overlap"]);
    expect(rules(trip("1", 9, { tafb: 20 }), vac(10))).toEqual(["overlap"]);
    expect(rules(trip("1", 16), vac(10))).toEqual(["overlap"]);
  });
  it("7.A.2: a trip starting after the vacation's last base day stays", () => {
    expect(rules(trip("1", 17), vac(10))).toEqual([]);
  });
  it("7.E.2.c: slid to within 48 hours after a trip ending in international duty: in conflict", () => {
    const t = trip("1", 8, { airports: ["MEM", "HKG"], tafb: 20 });
    expect(rules(t, vac(10), true)).toEqual(["after-international"]);
  });
  it("7.E.2.c applies \"if a pilot slides\": not to the vacation as awarded", () => {
    const t = trip("1", 8, { airports: ["MEM", "HKG"], tafb: 20 });
    expect(rules(t, vac(10), false)).toEqual([]);
  });
  it("7.E.2.c: except a trip under 12.D.1.c.i, domestic parameters", () => {
    const t = trip("1", 8, { airports: ["MEM", "YYZ"], tafb: 20 });
    expect(rules(t, vac(10), true)).toEqual([]);
  });
  it("7.G.1, 12.D.1.d.ii: the 48-hour buffer after an international trip over 120 hours can't be waived", () => {
    const t = trip("1", 3, { airports: ["MEM", "HKG"], tafb: 130 });
    expect(rules(t, vac(10), false)).toEqual(["buffer-after"]);
  });
  it("7.G.1, 12.D.1.d.i: the 24-hour buffer before one is a conflict", () => {
    const t = trip("1", 17, { airports: ["MEM", "HKG"], tafb: 130 });
    expect(rules(t, vac(10))).toEqual(["buffer-before"]);
  });
  it("7.G.1: that buffer \"may not be waived\" before December 2026, and may from it", () => {
    expect(frontBufferWaivable("NOV26")).toBe(false);
    expect(frontBufferWaivable("DEC26")).toBe(true);
    const dec = (t: Trip) => pack([line([t])], "DEC26");
    const t = trip("1", 17, { airports: ["MEM", "HKG"], tafb: 130 });
    const v = vac(10, 7, "DEC26");
    expect(vacationRemovals(line([t]), dec(t), spanOf(v), { slid: false })[0].waivable).toBe(true);
    expect(vacationRemovals(line([t]), dec(t), spanOf(v), { slid: false, waiveFrontBuffer: true })).toEqual([]);
    expect(vacationRemovals(line([t]), pack([line([t])]), spanOf(vac(10)), { slid: false, waiveFrontBuffer: true })[0].rule).toBe("buffer-before");
  });
  it("7.G.1: the bank pays the removed trips' SCH", () => {
    const removed = vacationRemovals(line([trip("1", 10, { credit: 18.2 }), trip("2", 13, { credit: 20 })]), pack([]), spanOf(vac(10)), { slid: false });
    expect(chargedToBank(removed)).toBeCloseTo(38.2);
  });
  it("charges a trip in conflict with two vacations once", () => {
    const l = line([trip("1", 10, { credit: 18.2 })]);
    const twice = [vac(9, 2), vac(11, 2)].flatMap((v) => vacationRemovals(l, pack([]), spanOf(v), { slid: false }));
    expect(twice).toHaveLength(2);
    expect(chargedToBank(twice)).toBeCloseTo(18.2);
  });
});

describe("corrections from the contract review", () => {
  it("7.E.2.b: this window can slide next month's vacation onto a trip carrying over, and only that", () => {
    const carrying = line([trip("1", 26, { tafb: 140 })]);
    const p = pack([carrying], "DEC26");
    const jan = (() => {
      const from = DateTime.fromISO("2027-01-01T01:30", { zone: ZONE });
      return { from: from.toUTC().toISO()!, to: from.plus({ days: 7 }).minus({ minutes: 1 }).toUTC().toISO()!, days: 7 };
    })();
    expect(slideChecks(jan, p).find((c) => c.offset === -1)?.carryoverOnly).toBe(true);
    expect(vacationsInReach([jan], p)).toHaveLength(1);
    const found = findVacationSlides({ pack: p, order: ["1001"], vacation: jan });
    expect(found.across.every((a) => a.offset === 0 || a.helps >= 0)).toBe(true);
    const none = line([trip("1", 3)]);
    const f2 = findVacationSlides({ pack: pack([none], "DEC26"), order: ["1001"], vacation: jan });
    expect(f2.lines[0].best).toEqual([]);
  });
  it("7.E.2.c applies to a slide, not an expansion", () => {
    const span = { start: Date.parse(vac(10).from), end: Date.parse(vac(10).to) };
    const t = trip("1", 8, { airports: ["MEM", "HKG"], tafb: 20 });
    expect(vacationRemovals(line([t]), pack([]), span, { slid: false })).toEqual([]);
  });
  it("7.E.2.c: last activity an international duty, though the leg ends inside the 48", () => {
    const t = trip("1", 8, { airports: ["YVR", "MEM"], tafb: 20 });
    const asia = { ...t, schedule: [...trip("2", 8, { airports: ["MEM", "HKG"], tafb: 1 }).schedule, ...t.schedule] };
    const span = { start: Date.parse(vac(10).from), end: Date.parse(vac(10).to) };
    expect(vacationRemovals(line([asia]), pack([]), span, { slid: true }).map((r) => r.rule)).toEqual(["after-international"]);
  });
  it("7.E.3.d: an expansion can't reach a trip on New Year's Eve, even when it ends past the month", () => {
    const start = DateTime.fromISO(START.DEC26);
    const end = DateTime.fromISO("2026-12-27").diff(start, "days").days;
    const l = line([trip("1", end, { credit: 12, tafb: 130 })]);
    const f = findVacationSlides({ pack: pack([l], "DEC26"), order: ["1001"], vacation: vac(end - 9, 7, "DEC26") });
    expect(f.lines[0].best.some((o) => o.expandAfter > 0)).toBe(false);
  });
});

describe("findVacationSlides", () => {
  const model = (metric: string): PilotModel => ({ criteria: [{ id: "c", label: "x", metric, weight: 1, shape: { kind: "more" }, tier: "major", confidence: 1 }] }) as unknown as PilotModel;
  const a = line([trip("1", 5, { credit: 15 }), trip("2", 16, { credit: 25 })], "1001");
  const b = line([trip("3", 2, { credit: 20 }), trip("4", 18, { credit: 20 })], "1002");
  const p = pack([a, b]);
  const order = ["1001", "1002"];

  it("7.G.1: a removed trip is still paid, and its days come off", () => {
    const f = findVacationSlides({ pack: p, order, vacation: vac(10) });
    const best = f.lines[0].best[0];
    expect(best.removed.length).toBeGreaterThan(0);
    expect(best.line.totalCreditHours).toBe(a.totalCreditHours);
    expect(best.daysOff).toBeGreaterThan(a.daysOff);
    expect(best.line.trips.length).toBe(a.trips.length - best.removed.length);
  });
  it("falls back to the pack's own lines when no ranked order is given, so it never reports 0 lines", () => {
    const f = findVacationSlides({ pack: p, order: [], vacation: vac(10) });
    expect(f.lines.length).toBeGreaterThan(0);
    expect(f.lines.length).toBe(p.lines.filter((l) => !l.estimated).length);
  });
  it("shows the best per line and never just the vacation as awarded again", () => {
    const f = findVacationSlides({ pack: p, order, vacation: vac(10) });
    for (const l of f.lines) {
      expect(l.best.length).toBeLessThanOrEqual(3);
      expect(l.best.some((o) => o.offset === 0 && !o.expandAfter && !o.expandBefore)).toBe(false);
    }
  });
  it("is scored on the pilot's own model, not on credit alone", () => {
    const f = findVacationSlides({ pack: p, order, vacation: vac(10), model: model("daysOff") });
    expect(f.byModel).toBe(true);
    expect(f.lines[0].best[0].score).not.toBeNull();
    const scores = f.lines[0].best.map((o) => o.score!);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });
  it("finds a slide across the top lines, the pilot's top line counting most", () => {
    const f = findVacationSlides({ pack: p, order, vacation: vac(10), model: model("daysOff") });
    expect(f.across.length).toBeGreaterThan(0);
    expect(f.across[0].offset).not.toBe(0);
    expect(f.across[0].gain).toBeGreaterThanOrEqual(f.across[f.across.length - 1].gain);
  });
  it("measures the across-lines gain in days off even with a model, so a real day-off gain isn't hidden by a flat score", () => {
    // Model rewards credit, not days off — the old score-first verdict would have reported the gain in model points
    // (and buried day-off gains). It must now be the weighted days-off delta.
    const f = findVacationSlides({ pack: p, order, vacation: vac(10), model: model("creditHours") });
    const top = f.across[0];
    const weight = (rank: number) => 1 / rank;
    const totalW = f.lines.reduce((s, l) => s + weight(l.rank), 0);
    const expected = f.lines.reduce((s, l) => {
      const slid = l.all.find((o) => o.offset === top.offset && !o.expandBefore && !o.expandAfter)!;
      return s + (slid.daysOff - l.asAwarded.daysOff) * weight(l.rank);
    }, 0) / totalW;
    expect(top.gain).toBeCloseTo(Math.round(expected * 10) / 10, 5);
  });
  it("orders the best slides by days off (concrete) first, not by the model's score", () => {
    // The model rewards credit, so score order would differ from days-off order; the best list must follow days off.
    const f = findVacationSlides({ pack: p, order, vacation: vac(10), model: model("creditHours") });
    const best = f.lines[0].best;
    for (let i = 1; i < best.length; i++) expect(best[i].daysOff).toBeLessThanOrEqual(best[i - 1].daysOff);
  });
  it("7.E.3.b: an expansion can't conflict with more than the vacation's CH value plus 6", () => {
    const heavy = line([trip("1", 5, { credit: 15 }), trip("2", 20, { credit: 50 })], "1003");
    const small = vac(10, 3);
    const f = findVacationSlides({ pack: pack([heavy]), order: ["1003"], vacation: small });
    const limit = 3 * CH_PER_VACATION_DAY + 6;
    const all = f.lines[0].best.filter((o) => o.expandAfter || o.expandBefore);
    for (const o of all) expect(o.chargedCH).toBeLessThanOrEqual(limit);
  });
  it("7.E.3: an expansion within the limit is offered, and says how many days", () => {
    const l = line([trip("1", 13, { credit: 12 })], "1004");
    const f = findVacationSlides({ pack: pack([l]), order: ["1004"], vacation: vac(3, 7) });
    const options = [...f.lines[0].best];
    expect(options.some((o) => o.expandAfter > 0 && o.removed.length === 1)).toBe(true);
  });
  it("7.E.3.d: no expansion conflict with a trip on Christmas", () => {
    const start = DateTime.fromISO(START.DEC26);
    const christmas = DateTime.fromISO("2026-12-25").diff(start, "days").days;
    const l = line([trip("1", christmas - 1, { credit: 12 })], "1005");
    const f = findVacationSlides({ pack: pack([l], "DEC26"), order: ["1005"], vacation: vac(christmas - 10, 7, "DEC26") });
    expect(f.lines[0].best.some((o) => o.expandAfter > 0)).toBe(false);
  });
  it("says what's illegal, for the panel", () => {
    const f = findVacationSlides({ pack: p, order, vacation: vac(2) });
    expect(f.illegal.map((c) => c.offset)).toContain(-3);
  });
});

describe("vacationsInReach", () => {
  it("keeps a vacation in the month, or that a legal slide brings into it", () => {
    const p = pack([]);
    expect(vacationsInReach([vac(10)], p)).toHaveLength(1);
    // Starts 3 days into next month: a slide back reaches this one.
    expect(vacationsInReach([vac(31)], p)).toHaveLength(1);
    expect(vacationsInReach([vac(60)], p)).toEqual([]);
  });
});

describe("typedVacation", () => {
  it("makes the same shape the pack prints: 0130 to 0129 in base days (7.A.2, 25.A.2)", () => {
    const t = typedVacation("2026-10-08", 7, { base: "MEM" })!;
    expect(DateTime.fromISO(t.from, { zone: ZONE }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-08 01:30");
    expect(DateTime.fromISO(t.to, { zone: ZONE }).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-10-15 01:29");
    expect(t.days).toBe(7);
  });
  it("refuses nonsense", () => {
    expect(typedVacation("nope", 7, { base: "MEM" })).toBeNull();
    expect(typedVacation("2026-10-08", 0, { base: "MEM" })).toBeNull();
  });
});

describe("slideWhere (CBA 2026 25.E.2.b)", () => {
  const event = (date: string, text: string) => ({ date, text, time: "07:00", zone: "CT" as const });
  it("reads the Conflict Input Window from the pack's own calendar, for this seat", () => {
    const p = { ...pack([]), bidCalendar: [event("2026-09-11", "OCT26 F/O Conflict Input Closes 0700 CT"), event("2026-09-09", "OCT26 CAP Conflict Input Closes 0700 CT")] };
    expect(slideWhere(p).closes).toContain("2026-09-09");
  });
  it("reads cells that don't name the month, under the bid opened above them", () => {
    const p = {
      ...pack([]),
      bidCalendar: [
        { date: "2026-09-03", text: "OCT26 Bid Opens 1700 CT", time: "17:00", zone: "CT" as const },
        { date: "2026-09-08", text: "CAP Conflict Input Window Opens 1700 CT", time: "17:00", zone: "CT" as const },
        event("2026-09-10", "CAP Conflict Input Window Closes 0700 CT"),
      ],
    };
    expect(slideWhere(p).opens).toBe("2026-09-08T22:00:00.000Z");
    expect(slideWhere(p).closes).toBe("2026-09-10T12:00:00.000Z");
  });
  it("finds no slides, and doesn't break, on a pack without the bid month's dates", () => {
    const p = { ...pack([line([trip("1", 5)])]), bidPeriodStart: undefined } as unknown as BidPack;
    const v = { from: "2026-10-10T05:00:00.000Z", to: "2026-10-16T04:59:00.000Z", days: 6 };
    const slides = findVacationSlides({ pack: p, order: ["1001"], vacation: v });
    expect(slides.lines).toEqual([]);
    expect(slides.across).toEqual([]);
  });
  it("25.E.2: the rule changes with December 2026", () => {
    expect(slideWhere(pack([])).rule).toContain("1700 CT");
    expect(slideWhere(pack([], "DEC26")).rule).toContain("5 hours after");
  });
});

