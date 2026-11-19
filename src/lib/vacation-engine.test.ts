import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { bestOption, bestPlacements, compareOptions, lineVacationOptions, vacationOptions, type VacationGoal } from "@/lib/vacation-engine";
import { flySchedule, vacationId, type ChosenVacation } from "@/lib/vacation-lines";
import { NO_ELECTIONS } from "@/lib/phase-in";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";

const ZONE = "America/Chicago";
const START = "2026-09-28";

/** A domestic trip of `days` days from grid day `day`, reporting 0800 at Memphis, through `cities`. */
function trip(num: string, day: number, opts: { days?: number; credit?: number; cities?: string[] } = {}): Trip {
  const days = opts.days ?? 2;
  const tafb = days * 24 - 10;
  return {
    id: `t-${num}`,
    pairingNumber: num,
    days,
    layoverCities: opts.cities ?? ["IND"],
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
        legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "0900", depTimeGmt: "1400", arrAirport: "IND", arrTimeLocal: "1100", arrTimeGmt: "1600", blockHours: 2, startMinutes: 60, endMinutes: tafb * 60, depTimeZulu: "", arrTimeZulu: "" }],
        layover: null,
      },
    ],
    zuluAnchor: "",
    startDayIndex: day,
  };
}

function line(trips: Trip[], lineNumber = "1001"): Line {
  const on = new Set(trips.flatMap((t) => Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i)));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return { id: `l-${lineNumber}`, lineNumber, trips, daysOff: off.length, totalCreditHours: trips.reduce((a, t) => a + t.creditHours, 0), totalTafbHours: trips.reduce((a, t) => a + t.tafbHours, 0), totalLandings: trips.length, totalDepartures: trips.length, gridOffDays: off };
}

const pack = (lines: Line[]): BidPack => ({ id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: START, lines });

/** A vacation of `days` base days from grid day `day`, 0130 to 0129 as the pack prints it. */
function vac(day: number, days = 7): VacationPeriod {
  const from = DateTime.fromISO(`${START}T01:30`, { zone: ZONE }).plus({ days: day });
  return { from: from.toUTC().toISO()!, to: from.plus({ days }).minus({ minutes: 1 }).toUTC().toISO()!, days };
}
const taking = (v: VacationPeriod): ChosenVacation => ({ vacation: v, choice: "use" });

// Trip A on days 8–9 (15 CH, Indianapolis), trip B on 14–15 (20 CH, Honolulu); the vacation awarded on days 10–16.
const A = trip("101", 8, { credit: 15, cities: ["IND"] });
const B = trip("202", 14, { credit: 20, cities: ["HNL"] });
const L = line([A, B]);
const P = pack([L]);
const V = vac(10);
const opts = lineVacationOptions(L, P, [taking(V)]);
const goal = (...aims: VacationGoal["aims"]): VacationGoal => ({ aims });
const offsetOf = (g: VacationGoal) => bestOption(opts, g)!.placement.offsets[vacationId(V)];

describe("every legal place the vacation can go on a line", () => {
  it("lists all 11 whole-day slides (CBA 2026 7.E.2.a), as awarded first", () => {
    expect(opts.options.map((o) => o.key)).toEqual(["0", "-1", "+1", "-2", "+2", "-3", "+3", "-4", "+4", "-5", "+5"]);
    expect(opts.reach).toEqual([{ id: vacationId(V), earlier: 5, later: 5 }]);
  });

  it("says what each one does: as awarded it takes trip B, paid from the bank", () => {
    const awarded = opts.options[0];
    expect(awarded).toMatchObject({ shift: 0, bankCH: 20, removedPairings: ["202"], removedCities: ["HNL"], flownCH: 15 });
  });
});

describe("the best place for what the pilot wants", () => {
  it("most credit: under both trips, 35 CH from the bank", () => {
    const best = bestOption(opts, goal({ kind: "credit" }))!;
    expect(best.bankCH).toBe(35);
    expect(best.removedPairings.sort()).toEqual(["101", "202"]);
  });

  it("keep my bank: under the smaller trip only, slid as little as that takes", () => {
    const best = bestOption(opts, goal({ kind: "keep-bank" }))!;
    expect(best.bankCH).toBe(15);
    expect(best.removedPairings).toEqual(["101"]);
    expect(offsetOf(goal({ kind: "keep-bank" }))).toBe(-3);
  });

  it("most days off, and the trips the pilot wants kept or dropped, by city", () => {
    const most = Math.max(...opts.options.map((o) => o.daysOff));
    expect(bestOption(opts, goal({ kind: "days-off" }))!.daysOff).toBe(most);
    expect(bestOption(opts, goal({ kind: "keep", cities: ["HNL"] }))!.removedPairings).not.toContain("202");
    expect(bestOption(opts, goal({ kind: "drop", cities: ["ind"] }))!.removedPairings).toContain("101");
  });

  it("days the pilot wants off: the vacation over them", () => {
    // Day 9 is trip A's: off only with the vacation over it, which a slide of a day earlier already does.
    expect(offsetOf(goal({ kind: "dates", days: [9] }))).toBe(-1);
    expect(bestOption(opts, goal({ kind: "dates", days: [9] }))!.offDays).toContain(9);
  });

  it("weighs aims in order, and calls a tie for the least slide: nothing to ask for when it changes nothing", () => {
    expect(offsetOf(goal({ kind: "as-awarded" }))).toBe(0);
    expect(bestOption(opts, null)!.shift).toBe(0);
    // Keep the Honolulu trip, then the most credit: off B, then under A as much as can be.
    const best = bestOption(opts, goal({ kind: "keep", cities: ["HNL"] }, { kind: "credit" }))!;
    expect(best.removedPairings).toEqual(["101"]);
    const same = opts.options.filter((o) => compareOptions(goal({ kind: "keep", cities: ["HNL"] }, { kind: "credit" }), o, best) === 0);
    expect(same).toEqual([best]);
  });
});

describe("one path for the math", () => {
  it("a line flown with its best slide has exactly what its option promised, as the ranking flies it", () => {
    const g = goal({ kind: "credit" });
    const all = vacationOptions(P, [taking(V)]);
    const placements = bestPlacements(all, g);
    const flown = flySchedule(P, { items: [], elections: NO_ELECTIONS }, [taking(V)], placements);
    const vl = flown.vacationLines.get(L.id)!;
    const best = bestOption(all.get(L.id)!, g)!;
    expect(vl.chargedCH).toBe(best.bankCH);
    expect(vl.daysOffAfter).toBe(best.daysOff);
    expect(vl.reason).toMatch(/^Slid \d days? (earlier|later), your vacation takes off/);
    // The pay doesn't change: removed trips are paid from the bank.
    expect(flown.pack.lines[0].totalCreditHours).toBe(L.totalCreditHours);
  });

  it("as awarded is the default: a goal that changes nothing places nothing", () => {
    expect(bestPlacements(vacationOptions(P, [taking(V)]), goal({ kind: "as-awarded" })).size).toBe(0);
    expect(bestPlacements(vacationOptions(P, [taking(V)]), null).size).toBe(0);
  });
});

describe("two vacations in a month", () => {
  it("are placed together, never on top of each other", () => {
    const two = lineVacationOptions(line([A, B, trip("303", 24)]), pack([L]), [taking(vac(3, 4)), taking(vac(10, 6))]);
    expect(two.options.length).toBeGreaterThan(11);
    for (const o of two.options) expect(Object.keys(o.placement.offsets)).toHaveLength(2);
    expect(two.reach).toHaveLength(2);
  });

  it("a vacation the pilot isn't taking isn't placed at all", () => {
    expect(lineVacationOptions(L, P, [{ vacation: V, choice: "not-taking" }]).options).toEqual([]);
  });
});

describe("ranked with the slide (the pilot's switch on)", () => {
  it("a line a slide gives more days off is measured with them, on the pilot's own priorities", async () => {
    const { scorePackV2 } = await import("@/lib/scoring-v2/score");
    const model = { criteria: [{ id: "c", label: "Days off", metric: "daysOff", weight: 1, shape: { kind: "more" }, tier: "major", confidence: 1 }] } as never;
    // A second line, so the scale is a pack's: the same trips three weeks on, its vacation days never touching them.
    const other = line([trip("301", 0), trip("302", 3)], "1002");
    const p = pack([L, other]);
    const all = vacationOptions(p, [taking(V)]);
    const goal: VacationGoal = { aims: [{ kind: "days-off" }] };
    const asAwarded = flySchedule(p, { items: [], elections: NO_ELECTIONS }, [taking(V)]);
    const slid = flySchedule(p, { items: [], elections: NO_ELECTIONS }, [taking(V)], bestPlacements(all, goal));
    // What the ranking measures on the line (its score is on a scale the pack sets, and this line tops a pack of two).
    const measured = (pk: BidPack) => scorePackV2(pk, model).find((s) => s.lineId === L.id)!.results[0].value!;
    const best = bestOption(all.get(L.id)!, goal)!;
    expect(best.daysOff).toBeGreaterThan(all.get(L.id)!.options[0].daysOff);
    // Scored as the very line its option describes.
    expect(slid.pack.lines.find((l) => l.id === L.id)!.daysOff).toBe(best.daysOff);
    expect(measured(slid.pack)).toBe(best.daysOff);
    expect(measured(slid.pack)).toBeGreaterThan(measured(asAwarded.pack));
  });
});
