import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { NO_ELECTIONS, type CarryInTrip } from "@/lib/phase-in";
import { MAX_CHOICES, buildViewAdd, busyFromCarry, busyFromTrip, fitCheck, lineWithAdded, overageCH, parseOpenTimeList, twoTripDutyLimitHours, viewAddCopyText, workStretches, type Busy } from "@/lib/view-add";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

const ZONE = "America/Chicago";

function trip(num: string, startDayIndex: number, opts: { tafb?: number; credit?: number; airports?: string[]; report?: string } = {}): Trip {
  const tafb = opts.tafb ?? 30;
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
    creditHours: opts.credit ?? 12,
    landings: 1,
    tafbHours: tafb,
    departures: 1,
    dutyPeriods: 1,
    schedule: [{ reportTimeLocal: opts.report ?? "0800", startMinutes: 0, legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: airports[0], depTimeLocal: "0900", depTimeGmt: "1400", arrAirport: airports[1], arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 2, startMinutes: 60, endMinutes: tafb * 60, depTimeZulu: "", arrTimeZulu: "" }], layover: null }],
    zuluAnchor: "",
    startDayIndex,
  };
}

function line(trips: Trip[], lineNumber = "1001"): Line {
  const on = new Set(trips.flatMap((t) => Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i)));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return { id: `l-${lineNumber}`, lineNumber, trips, daysOff: off.length, totalCreditHours: trips.reduce((a, t) => a + t.creditHours, 0), totalTafbHours: trips.reduce((a, t) => a + t.tafbHours, 0), totalLandings: trips.length, totalDepartures: trips.length, gridOffDays: off };
}

const START = { NOV26: "2026-10-26", DEC26: "2026-11-30" };
function pack(lines: Line[], openPairings: Trip[], month: keyof typeof START = "DEC26"): BidPack {
  return { id: "p", month, base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: START[month], lines, openPairings };
}

const busy = (t: Trip): Busy => busyFromTrip(t, pack([], []))!;

describe("fitCheck: can it go on the schedule", () => {
  const p = pack([], []);
  it("an overlap rules it out", () => {
    expect(fitCheck(trip("2", 5), [busy(trip("1", 5))], [], p).illegal[0]).toContain("overlaps trip 1");
  });
  it("CBA 2026 12.C.6.a: 9:30 of domestic rest from December 2026 is two separate duties", () => {
    const f = fitCheck(trip("2", 5), [busy(trip("1", 4, { tafb: 14.5 }))], [], p);
    expect(f.illegal).toEqual([]);
    expect(f.check).toEqual([]);
  });
  it("CBA 2026 12.C.4.e: under the rest it's one duty, legal up to the two-trip limit, and flagged", () => {
    const f = fitCheck(trip("2", 5, { tafb: 3 }), [busy(trip("1", 4, { tafb: 6, report: "2300" }))], [], p);
    expect(f.illegal).toEqual([]);
    expect(f.check.join()).toContain("hub turns");
  });
  it("CBA 2026 12.C.4.e: past 13:30 as one duty it's out", () => {
    const f = fitCheck(trip("2", 5, { tafb: 8 }), [busy(trip("1", 4, { tafb: 7, report: "2300" }))], [], p);
    expect(f.illegal.join()).toContain("12.C.4.e");
  });
  it("CBA 2026 12.C.4.j: under 1:30 between block-in and block-out it's out", () => {
    const f = fitCheck(trip("2", 5), [busy(trip("1", 4, { tafb: 23.8 }))], [], p);
    expect(f.illegal.join()).toContain("12.C.4.j");
  });
  it("two-trip limits: 13:30 day, 13 night, 9 critical", () => {
    expect(twoTripDutyLimitHours(600)).toBe(13.5);
    expect(twoTripDutyLimitHours(1200)).toBe(13);
    expect(twoTripDutyLimitHours(120)).toBe(9);
  });
  it("CBA 2026 12.D.7: an international duty needs 12 hours", () => {
    const t = trip("2", 5, { airports: ["MEM", "HKG"] });
    expect(fitCheck(t, [busy(trip("1", 4, { tafb: 13 }))], [], p).illegal[0]).toContain("12.D.7");
  });
  it("CBA 2026 12.D.7.c: 17 hours after an international duty over 12 on duty", () => {
    const long = busy(trip("1", 3, { airports: ["MEM", "HKG"], tafb: 34 }));
    expect(fitCheck(trip("2", 5), [long], [], p).illegal.join()).toContain("12.D.7.c");
  });
  it("CBA 2026 12.C.6.b: 13 hours after over 8 domestic block is out; 13 to 17 is a question", () => {
    const heavy = (tafb: number): Busy => ({ ...busy(trip("1", 4, { tafb })), lastDutyBlockHours: 9 });
    expect(fitCheck(trip("2", 5), [heavy(12)], [], p).illegal.join()).toContain("12.C.6.b");
    expect(fitCheck(trip("2", 5), [heavy(9)], [], p).check.join()).toContain("exception pairing");
  });
  it("CBA 2026 25.L.1.d: an R-day wants 12 hours, not a domestic rest", () => {
    const r = busyFromCarry({ kind: "rdays", id: "r", label: "Your R-days", firstDay: "2026-12-03", days: 1, rp: "A" }, ZONE)!;
    // RP-A ends 13:30 on day 3; a report at 08:00 on day 4 is 18:30 later, and at 23:30 on day 3 only 10.
    expect(fitCheck(trip("2", 4), [r], [], p).illegal).toEqual([]);
    expect(fitCheck({ ...trip("2", 3), schedule: trip("2", 3).schedule.map((d) => ({ ...d, reportTimeLocal: "2330" })) }, [r], [], p).illegal.join()).toContain("25.L.1.d");
  });
  it("CBA 2026 7.A.3: nothing during vacation", () => {
    const start = DateTime.fromISO(`${START.DEC26}T01:30`, { zone: ZONE }).plus({ days: 4 });
    const v: VacationPeriod = { from: start.toUTC().toISO()!, to: start.plus({ days: 7 }).toUTC().toISO()!, days: 7 };
    expect(fitCheck(trip("2", 5), [], [v], p).illegal[0]).toContain("7.A.3");
  });
  it("CBA 2026 7.G.1: a vacation inside a long international trip's buffer is flagged", () => {
    const t = trip("2", 1, { airports: ["MEM", "HKG"], tafb: 130 });
    const start = DateTime.fromISO(`${START.DEC26}T08:00`, { zone: ZONE }).plus({ days: 1 }).plus({ hours: 140 });
    const v: VacationPeriod = { from: start.toUTC().toISO()!, to: start.plus({ days: 7 }).toUTC().toISO()!, days: 7 };
    expect(fitCheck(t, [], [v], p).check.join()).toContain("48-hour international buffer");
  });
  it("CBA 2026 12.C.1.b: past 144 hours with no 24 hours off rules it out; the October lines reach 144 and never pass it", () => {
    const run = [0, 1, 2, 3, 4, 5].map((d) => busy(trip(String(d), d, { tafb: 10 })));
    expect(fitCheck(trip("9", 6, { tafb: 10 }), run, [], p).illegal.join()).toContain("12.C.1.b");
    const shorter = [0, 1, 2, 3, 4].map((d) => busy(trip(String(d), d, { tafb: 10 })));
    const f = fitCheck(trip("9", 5, { tafb: 10 }), shorter, [], p);
    expect(f.illegal).toEqual([]);
    expect(f.check.join()).not.toContain("1-in-7");
  });
  it("CBA 2026 12.D.1.d: buffers only flag on a make-up trip (question 27)", () => {
    const t = trip("2", 5, { airports: ["MEM", "HKG"], tafb: 130 });
    const f = fitCheck(t, [busy(trip("1", 4, { tafb: 8 }))], [], p);
    expect(f.illegal.join()).not.toContain("12.D.1.d");
    expect(f.check.join()).toContain("12.D.1.d.i");
  });
});

describe("overageCH (CBA 2026 25.L.6.e)", () => {
  it("is 6 CH before December 2026, 7 from it", () => {
    expect(overageCH("NOV26")).toBe(6);
    expect(overageCH("DEC26")).toBe(7);
  });
});

describe("parseOpenTimeList", () => {
  it("reads a trip number and date, however the date's written", () => {
    const { entries, notRead } = parseOpenTimeList("213 14OCT\nOCT 15 214\n215 10/16\nTrip 216 Oct 17\nnothing useful here");
    expect(entries.map((e) => [e.tripNumber, e.month, e.day])).toEqual([["213", 10, 14], ["214", 10, 15], ["215", 10, 16], ["216", 10, 17]]);
    expect(notRead).toEqual(["nothing useful here"]);
  });
  it("keeps the pilot's own text", () => {
    expect(parseOpenTimeList("  213 14OCT  ").entries[0].raw).toBe("213 14OCT");
  });
});

describe("lineWithAdded", () => {
  it("adds its credit, and takes its days off away", () => {
    const l = line([trip("1", 3, { credit: 20 })]);
    const p = pack([l], []);
    const added = lineWithAdded(l, [trip("2", 10, { credit: 15 })], p);
    expect(added.totalCreditHours).toBe(35);
    expect(added.gridOffDays).not.toContain(10);
    expect(added.daysOff).toBeLessThan(l.daysOff);
    expect(added.trips.map((t) => t.pairingNumber)).toEqual(["1", "2"]);
  });
  it("workStretches counts separate runs of work", () => {
    expect(workStretches(line([trip("1", 3), trip("2", 10)]), 28)).toBe(2);
  });
});

describe("buildViewAdd", () => {
  const model = (metric: string): PilotModel => ({ criteria: [{ id: "c", label: "x", metric, weight: 1, shape: { kind: "more" }, tier: "major", confidence: 1 }] }) as unknown as PilotModel;
  const dropped = trip("213", 0, { credit: 24, tafb: 30 });
  const l = line([dropped, trip("300", 14)]);
  const open = [trip("500", 4, { credit: 24, tafb: 50 }), trip("501", 8, { credit: 12 }), trip("502", 18, { credit: 13 }), trip("503", 14, { credit: 12 }), trip("504", 7, { credit: 60, tafb: 90 })];
  const p = pack([l], open);
  const report = DateTime.fromISO(`${START.DEC26}T08:00`, { zone: ZONE });
  const carry: CarryInTrip = { kind: "trip", id: "c", label: "Trip 900", report: report.minus({ hours: 40 }).toUTC().toISO()!, release: report.plus({ hours: 2 }).toUTC().toISO()!, international: false };
  const build = (extra = {}) => buildViewAdd({ pack: p, line: l, carryIn: [carry], elections: NO_ELECTIONS, ...extra });

  it("CBA 2026 25.F.5: the make-up is what the carry-in dropped", () => {
    const plan = build();
    expect(plan.targetCH).toBe(24);
    expect(plan.flown.dropped.map((d) => d.trip.pairingNumber)).toEqual(["213"]);
  });
  it("rules out what can't fly, with why", () => {
    const plan = build();
    expect(plan.ruledOut.find((r) => r.trip.pairingNumber === "503")?.why).toContain("overlaps trip 300");
  });
  it("CBA 2026 25.L.6.e: rules out a trip more than 7 CH past the make-up", () => {
    expect(build().ruledOut.find((r) => r.trip.pairingNumber === "504")?.why).toContain("25.L.6.e");
  });
  it("CBA 2026 25.L.6.d: a trip can't mix pay codes, so it's held to the larger bucket", () => {
    const plan = build({ makeUp: { cia: 14, muv: 14 } });
    expect(plan.targetCH).toBe(28);
    expect(plan.ruledOut.find((r) => r.trip.pairingNumber === "500")?.why).toContain("25.L.6.e");
  });
  it("finds the combination that restores the hours, most days off first", () => {
    const plan = build();
    const best = plan.combos[0];
    expect(best.shortCH).toBe(0);
    expect(best.totalCH).toBeGreaterThanOrEqual(24);
    for (const c of plan.combos.filter((x) => x.shortCH === 0)) expect(best.daysOffAfter).toBeGreaterThanOrEqual(c.daysOffAfter);
  });
  it("puts the best combination first in the list, and explains every choice", () => {
    const plan = build();
    const top = plan.combos[0].trips.length;
    expect(plan.choices.slice(0, top).every((c) => c.inBest)).toBe(true);
    for (const c of plan.choices) expect(c.why.length).toBeGreaterThan(10);
  });
  it("lets the pilot's own model pick among those that restore the hours", () => {
    const plan = build({ model: model("creditHours") });
    expect(plan.byModel).toBe(true);
    expect(plan.combos[0].score).not.toBeNull();
    expect(plan.choices[0].score).not.toBeNull();
  });
  it("uses VIPS's own list once pasted, keeping its text, and finds trips on other lines (another pilot's conflict)", () => {
    const other = line([trip("700", 20)], "1002");
    const q = pack([l, other], open);
    const plan = buildViewAdd({ pack: q, line: l, carryIn: [carry], elections: NO_ELECTIONS, pasted: "700 20DEC\n501 8DEC\n999 9DEC\ngarbled" });
    expect(plan.fromPackOnly).toBe(false);
    expect(plan.choices.map((c) => c.trip?.pairingNumber).sort()).toEqual(["501", "700"]);
    expect(plan.choices.find((c) => c.trip?.pairingNumber === "700")?.text).toBe("700 20DEC");
    expect(plan.notInPack).toEqual(["999 9DEC"]);
    expect(plan.notRead).toEqual(["garbled"]);
  });
  it("CBA 2026 25.E.4.a.iv: keeps reserve block and simulator labels as typed", () => {
    const plan = build({ labels: "RES BLOCK A12\nSIM 4" });
    expect(plan.choices.slice(-2).map((c) => c.text)).toEqual(["RES BLOCK A12", "SIM 4"]);
    expect(plan.choices.slice(-1)[0].trip).toBeNull();
  });
  it("stops at the form's limit", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...trip(String(1000 + i), 20 + (i % 7), { credit: 5, tafb: 4 }), id: `m-${i}` }));
    const plan = buildViewAdd({ pack: pack([l], many), line: l, carryIn: [carry], elections: NO_ELECTIONS });
    expect(plan.choices.length).toBeLessThanOrEqual(MAX_CHOICES);
  });
  it("nothing owed: no combination, but the trips are still ranked", () => {
    const plan = buildViewAdd({ pack: p, line: l, carryIn: [], elections: NO_ELECTIONS });
    expect(plan.targetCH).toBe(0);
    expect(plan.combos).toEqual([]);
    expect(plan.choices.length).toBeGreaterThan(0);
  });
  it("copies as a numbered list", () => {
    const text = viewAddCopyText({ choices: [{ text: "213 14OCT" }, { text: "214 15OCT" }] as never });
    expect(text).toBe("1. 213 14OCT\n2. 214 15OCT");
  });
});
