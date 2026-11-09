import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { contractNode, fullText } from "@/lib/contract";
import { normalizeForMatch } from "@/lib/contract/validate";
import { evaluateOpenTime, MAX_ROWS, type OpenTimeSituation, type OpenTrip } from "@/lib/open-time/engine";
import { pasteSnapshot } from "@/lib/open-time/parse";
import { samplePaste } from "@/lib/open-time/sample";
import type { OpenTimeSnapshot } from "@/lib/open-time/source";
import { NO_ELECTIONS, type CarryInItem } from "@/lib/phase-in";
import { pairingDate, parseOpenTimeList, tripKey } from "@/lib/view-add";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

const ZONE = "America/Chicago";

function trip(num: string, startDayIndex: number, opts: { tafb?: number; credit?: number; airports?: string[]; id?: string; report?: string } = {}): Trip {
  const tafb = opts.tafb ?? 30;
  const airports = opts.airports ?? ["MEM", "IND"];
  const report = opts.report ?? "0800";
  // Memphis is GMT−6 in late November and December, GMT−5 before: the depart time only places the pairing page's date.
  return {
    id: opts.id ?? `t-${num}`,
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
    schedule: [{ reportTimeLocal: report, startMinutes: 0, legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: airports[0], depTimeLocal: "0900", depTimeGmt: "1500", arrAirport: airports[1], arrTimeLocal: "1100", arrTimeGmt: "1700", blockHours: 2, startMinutes: 60, endMinutes: tafb * 60, depTimeZulu: "", arrTimeZulu: "" }], layover: null }],
    zuluAnchor: "",
    startDayIndex,
  };
}

function line(trips: Trip[], lineNumber = "1001"): Line {
  const on = new Set(trips.flatMap((t) => Array.from({ length: t.days }, (_, i) => t.startDayIndex! + i)));
  const off = Array.from({ length: 28 }, (_, i) => i).filter((i) => !on.has(i));
  return { id: `l-${lineNumber}`, lineNumber, trips, daysOff: off.length, totalCreditHours: trips.reduce((a, t) => a + t.creditHours, 0), totalTafbHours: trips.reduce((a, t) => a + t.tafbHours, 0), totalLandings: trips.length, totalDepartures: trips.length, gridOffDays: off };
}

const START: Record<string, string> = { NOV26: "2026-10-26", DEC26: "2026-11-30", JAN27: "2026-12-28", AUG27: "2027-07-26" };
function pack(lines: Line[], openPairings: Trip[], month = "DEC26"): BidPack {
  return { id: "p", month, base: "MEM", aircraft: "B767", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: START[month], lines, openPairings };
}

/** The date a trip on this pack starts, in the row format a pilot might paste. */
const rowFor = (t: Trip, p: BidPack) => `${t.pairingNumber} ${DateTime.fromISO(pairingDate(t, p)!, { zone: "utc" }).toFormat("L/d")}`;

const NOW = DateTime.fromISO("2026-11-20T12:00", { zone: ZONE }).toMillis();

function board(p: BidPack, text: string, over: Partial<OpenTimeSituation> = {}) {
  return evaluateOpenTime(pasteSnapshot(text, NOW), { pack: p, line: null, carryIn: [], elections: NO_ELECTIONS, banks: {}, now: NOW, ...over });
}

const only = (b: ReturnType<typeof board>): OpenTrip => {
  expect(b.trips).toHaveLength(1);
  return b.trips[0];
};
const sections = (t: OpenTrip, level?: string) => t.findings.filter((f) => !level || f.level === level).map((f) => f.section);

function quotes(section: string, words: string) {
  expect(contractNode(section), section).toBeDefined();
  expect(normalizeForMatch(fullText(section))).toContain(normalizeForMatch(words));
}

const model: PilotModel = {
  version: 2,
  home: { airports: ["MEM"], commuter: false },
  criteria: [
    { id: "credit", label: "credit", metric: "creditHours", weight: 1, shape: { kind: "more" }, tier: "major", confidence: 1 },
    { id: "off", label: "days off", metric: "daysOff", weight: 2, shape: { kind: "more" }, tier: "major", confidence: 1 },
  ],
} as unknown as PilotModel;

describe("rows to trips", () => {
  const open = trip("213", 10);
  const p = pack([], [open]);

  it("finds a row's trip, on its date", () => {
    const t = only(board(p, rowFor(open, p)));
    expect(t.key).toBe(tripKey(open));
  });

  it("finds a trip on another pilot's line: their drop or conflict puts it in open time", () => {
    const onLine = trip("300", 12);
    const q = pack([line([onLine], "1099")], []);
    expect(only(board(q, rowFor(onLine, q))).key).toBe(tripKey(onLine));
  });

  it("a trip it can't find is said to be not in the pack, and isn't scored or checked", () => {
    const b = board(p, "999 12/15", { model });
    expect(b.trips).toEqual([]);
    expect(b.notInPack).toHaveLength(1);
    expect(b.notInPack[0].why).toContain("No trip 999");
  });

  it("the pack settles which number is the trip", () => {
    const date = DateTime.fromISO(pairingDate(open, p)!, { zone: "utc" }).toFormat("ddLLL").toUpperCase();
    expect(only(board(p, `213 ${date} 1430`)).key).toBe(tripKey(open));
    expect(only(board(p, `1430 213 ${date}`)).key).toBe(tripKey(open));
  });

  it("when it can't, the row comes back unread rather than guessed at", () => {
    const also = trip("1430", 10);
    const q = pack([], [open, also]);
    const date = DateTime.fromISO(pairingDate(open, q)!, { zone: "utc" }).toFormat("ddLLL").toUpperCase();
    const both = board(q, `213 ${date} 1430`);
    expect(both.trips).toEqual([]);
    expect(both.unread[0].why).toContain("Both 213 and 1430");
    const neither = board(p, `555 ${date} 1430`);
    expect(neither.trips).toEqual([]);
    expect(neither.unread[0].why).toContain("couldn't tell which number");
  });

  it("flags a trip that also flies a day away: which date VIPS prints isn't known", () => {
    const next = trip("213", 11);
    const q = pack([], [open, next]);
    const t = only(board(q, rowFor(open, q)));
    expect(t.key).toBe(tripKey(open));
    expect(sections(t, "check")).toContain("open-time-date");
  });

  it("flags a match a day out", () => {
    const d = DateTime.fromISO(pairingDate(open, p)!, { zone: "utc" }).plus({ days: 1 }).toFormat("L/d");
    expect(sections(only(board(p, `213 ${d}`)), "check")).toContain("open-time-date");
  });

  it("flags a row that disagrees with the pack: it may have been revised", () => {
    const d = rowFor(open, p);
    expect(sections(only(board(p, `${d} CH 20`)), "check")).toContain("open-time-revised");
    expect(sections(only(board(p, `${d} TAFB 99`)), "check")).toContain("open-time-revised");
    expect(sections(only(board(p, `${d} RPT 1500`)), "check")).toContain("open-time-revised");
    expect(sections(only(board(p, `${d} CH 12 TAFB 30 RPT 0800`)), "check")).not.toContain("open-time-revised");
  });

  it("a figure rounded to one place isn't a revision", () => {
    const q = pack([], [trip("213", 10, { tafb: 28.75, credit: 7.55 })]);
    expect(sections(only(board(q, `${rowFor(q.openPairings![0], q)} CH 7.6 TAFB 28.8`)), "check")).not.toContain("open-time-revised");
  });

  it("a row printed twice is one trip", () => {
    expect(board(p, `${rowFor(open, p)}\n${rowFor(open, p)}`).trips).toHaveLength(1);
  });

  it("a trip already on the pilot's line is said to be", () => {
    const mine = trip("213", 10);
    const l = line([mine]);
    const q = pack([l], []);
    const b = board(q, rowFor(mine, q), { line: l });
    expect(b.trips).toEqual([]);
    expect(b.onLine).toHaveLength(1);
  });

  it("a January date in a pack that starts in December finds its trip", () => {
    const january = trip("400", 10);
    const q = pack([], [january], "JAN27");
    expect(pairingDate(january, q)).toBe("2027-01-07");
    expect(only(board(q, "400 1/7")).key).toBe(tripKey(january));
  });

  it("a pack with no dates matches nothing, and says so", () => {
    const b = board({ ...p, bidPeriodStart: null }, "213 12/10");
    expect(b.noDates).toBe(true);
    expect(b.trips).toEqual([]);
  });

  it("says what it left off past the limit", () => {
    const text = Array.from({ length: MAX_ROWS + 3 }, () => "999 12/15").join("\n");
    expect(board(p, text).rowsLeftOff).toBe(3);
  });
});

describe("View/Add shares the parser", () => {
  it("reads what it always did", () => {
    const { entries, notRead } = parseOpenTimeList("213 14OCT\nnothing useful here");
    expect(entries[0]).toMatchObject({ tripNumber: "213", month: 10, day: 14 });
    expect(notRead).toEqual(["nothing useful here"]);
  });
  it("no longer takes a time for the trip", () => {
    expect(parseOpenTimeList("10/14 0900 213").entries[0].tripNumber).toBe("213");
  });
});

describe('CBA 2026 25.L.1.d: "prohibited if it would create a conflict", on the pilot\'s schedule', () => {
  const mine = trip("100", 10);
  const l = line([mine]);

  it("quotes the contract", () => {
    quotes("25.L.1.d", "or if the pilot making such would not be legal to operate another scheduled activity as a result of the bid line adjustment");
    quotes("12.D.1.d.iii", "A pilot is deemed to have waived any conflict with the international buffer resulting from a bid line adjustment");
    quotes("12.C.1.c", "It shall not be a violation of this rule if a pilot would have received the relief from duty required by this paragraph but for a bid line adjustment");
    quotes("12.C.6.a", "A domestic rest period shall be scheduled for not less than 9:30 hours");
  });

  it("an overlap rules it out", () => {
    const clash = trip("213", 10);
    const p = pack([l], [clash]);
    expect(only(board(p, rowFor(clash, p), { line: l }))).toMatchObject({ verdict: "no" });
  });

  it("under the legal rest, CBA 2026 12.C.4.e: too long as one duty with the trip before it rules it out", () => {
    // 30 hours of TAFB from 0800 ends 1400 next day; a 1500 show is under any rest, so the two would have to be one duty.
    const close = trip("213", 11, { report: "1500", tafb: 10 });
    const p = pack([l], [close]);
    const t = only(board(p, rowFor(close, p), { line: l }));
    expect(t.verdict).toBe("no");
    expect(t.findings.find((f) => f.level === "no")?.text).toContain("12.C.4");
  });

  it("under the legal rest with 4 hours on the ground, it's a question: a day room can lift the limit (CBA 2026 12.C.4.d.iv)", () => {
    const close = trip("213", 11, { report: "2200", tafb: 10 });
    const p = pack([l], [close]);
    const t = only(board(p, rowFor(close, p), { line: l }));
    expect(t.verdict).toBe("check");
    expect(t.findings.find((f) => f.level === "check")?.text).toContain("12.C.4.d.iv");
  });

  it("a clear trip passes", () => {
    const clear = trip("213", 20);
    const p = pack([l], [clear]);
    expect(only(board(p, rowFor(clear, p), { line: l })).verdict).toBe("open");
  });

  it("with no line, says nothing's been checked rather than passing it", () => {
    const clash = trip("213", 10);
    const p = pack([l], [clash]);
    const b = board(p, rowFor(clash, p));
    expect(b.scheduleChecked).toBe(false);
    expect(only(b).verdict).toBe("open");
  });

  it("a vacation rules it out", () => {
    const open = trip("213", 20);
    const p = pack([l], [open]);
    const start = DateTime.fromISO(START.DEC26, { zone: ZONE }).plus({ days: 19 });
    const vacations = [{ from: start.toUTC().toISO()!, to: start.plus({ days: 5 }).toUTC().toISO()!, days: 5 }];
    expect(only(board(p, rowFor(open, p), { line: l, vacations })).verdict).toBe("no");
  });

  it("25.L.1.d.i: R-days carried in need 12 hours clear", () => {
    const open = trip("213", 1, { tafb: 10 });
    const p = pack([l], [open]);
    const end = DateTime.fromISO(START.DEC26, { zone: ZONE }).plus({ days: 1 }).set({ hour: 18 });
    // Trip ends 1800; RP-A next day starts 0130: only 7:30 clear.
    const rdays: CarryInItem = { kind: "rdays", id: "r", label: "your R-days", firstDay: end.plus({ days: 1 }).toISODate()!, days: 2, rp: "A" };
    const t = only(board(p, rowFor(open, p), { line: l, carryIn: [rdays] }));
    expect(t.verdict).toBe("no");
    expect(sections(t, "no")).toContain("25.L.1.d");
  });

  it("12.D.1.d.iii: a buffer conflict a bid line adjustment excuses is a note, not a flag", () => {
    const long = trip("100", 3, { tafb: 130, airports: ["MEM", "HKG"] });
    const m = line([long]);
    // Ends on day 8 about 1800; this show is 30 hours later: legal rest, inside the 48-hour buffer.
    const after = trip("213", 10, { report: "0000", tafb: 10 });
    const p = pack([m], [after]);
    const t = only(board(p, rowFor(after, p), { line: m }));
    expect(t.findings.find((f) => f.section === "12.D.1.d.iii")?.level).toBe("note");
    expect(t.verdict).toBe("open");
  });
});

describe("CBA 2026 25.L.1.b on a trip", () => {
  const open = trip("213", 10);
  const p = pack([], [open]);
  const show = DateTime.fromISO(START.DEC26, { zone: ZONE }).plus({ days: 10 }).set({ hour: 8 });
  const situation = (now: number) => evaluateOpenTime(pasteSnapshot(rowFor(open, p), now), { pack: p, line: null, carryIn: [], elections: NO_ELECTIONS, banks: {}, now });
  it("before 0900 LBT the day before: open", () => {
    expect(situation(show.minus({ days: 1 }).set({ hour: 8, minute: 59 }).toMillis()).trips[0].verdict).toBe("open");
  });
  it("after it: late, and the Company's call", () => {
    expect(situation(show.minus({ days: 1 }).set({ hour: 9, minute: 1 }).toMillis()).trips[0].verdict).toBe("late");
  });
  it("after the show: gone", () => {
    expect(situation(show.plus({ minutes: 1 }).toMillis()).trips[0].verdict).toBe("no");
  });
  it("the first affected activity is the trip given up, if that's sooner", () => {
    const mine = trip("100", 5);
    const l = line([mine]);
    const q = pack([l], [open]);
    const b = evaluateOpenTime(pasteSnapshot(rowFor(open, q), DateTime.fromISO(START.DEC26, { zone: ZONE }).plus({ days: 5 }).toMillis()), { pack: q, line: l, carryIn: [], elections: NO_ELECTIONS, banks: {}, giveUp: { key: tripKey(mine), as: "trade", assignedAs: "LINE" }, now: DateTime.fromISO(START.DEC26, { zone: ZONE }).plus({ days: 4, hours: 10 }).toMillis() });
    expect(b.trips[0].verdict).toBe("late");
  });
});

describe("banks on a trip: CBA 2026 25.L.4.d, 25.L.5.c, 25.L.6.e", () => {
  const open = trip("213", 10, { credit: 20 });
  const p = pack([], [open]);
  const row = rowFor(open, p);

  it("no bank entered: no verdict from banks", () => {
    expect(only(board(p, row)).verdict).toBe("open");
  });
  it("past every bank entered: can't take it, naming the section", () => {
    const t = only(board(p, row, { banks: { "M/U": 12 } }));
    expect(t.verdict).toBe("no");
    expect(sections(t, "no")).toContain("25.L.6.e");
  });
  it("past every bank: names the one that comes closest", () => {
    const t = only(board(p, row, { banks: { PMU: 2, "M/U": 12 } }));
    expect(t.findings.find((f) => f.level === "no")?.text).toContain("12.0 CH of M/U");
  });
  it("one bank is enough", () => {
    const t = only(board(p, row, { banks: { "M/U": 2, MUV: 13 } }));
    expect(t.verdict).toBe("open");
    expect(t.banks.filter((b) => b.eligible).map((b) => b.code)).toEqual(["MUV"]);
  });
  it("switches with the bid period: 13 CH of make-up takes a 20 CH trip in December, not in November", () => {
    const q = pack([], [trip("213", 10, { credit: 20 })], "NOV26");
    const r = rowFor(q.openPairings![0], q);
    const novNow = DateTime.fromISO("2026-10-20T12:00", { zone: ZONE }).toMillis();
    expect(evaluateOpenTime(pasteSnapshot(r, novNow), { pack: q, line: null, carryIn: [], elections: NO_ELECTIONS, banks: { "M/U": 13 }, now: novNow }).trips[0].verdict).toBe("no");
    expect(only(board(p, row, { banks: { "M/U": 13 } })).verdict).toBe("open");
  });
  it("a row's own CH beats the pack's for the limit: VIPS is newer", () => {
    expect(only(board(p, `${row} CH 10`, { banks: { "M/U": 3 } })).banks[0].eligible).toBe(true);
  });
  it("25.L.4.b: PMU's priority cut-off is on the trip", () => {
    expect(sections(only(board(p, row, { banks: { PMU: 20 } })))).toContain("25.L.4.b");
  });
  it("25.L.5.a: PNP's too", () => {
    expect(sections(only(board(p, row, { banks: { PNP: 20 } })))).toContain("25.L.5.a");
  });
});

describe("giving up a trip", () => {
  const mine = trip("100", 10, { credit: 10 });
  const l = line([mine]);
  const giveUp = (as: "trade" | "drop", assignedAs: "LINE" | "PMU" | "CMU" = "LINE") => ({ giveUp: { key: tripKey(mine), as, assignedAs }, line: l });

  it("a trip that overlapped only the one given up now fits", () => {
    const open = trip("213", 10);
    const p = pack([l], [open]);
    expect(only(board(p, rowFor(open, p), { line: l })).verdict).toBe("no");
    expect(only(board(p, rowFor(open, p), giveUp("trade"))).verdict).not.toBe("no");
  });

  it("CBA 2026 25.L.1.h: a CMU trip can't be traded or dropped, in any bid period", () => {
    const open = trip("213", 20);
    const p = pack([l], [open]);
    for (const as of ["trade", "drop"] as const) {
      const t = only(board(p, rowFor(open, p), giveUp(as, "CMU")));
      expect(t.verdict).toBe("no");
      expect(sections(t, "no")).toContain("25.L.1.h");
    }
  });

  it("CBA 2026 25.L.1.h: a PMU trip can't from December 2026, and could before it", () => {
    const open = trip("213", 20);
    const dec = pack([l], [open]);
    expect(sections(only(board(dec, rowFor(open, dec), giveUp("trade", "PMU"))), "no")).toContain("25.L.1.h");
    const nov = pack([l], [open], "NOV26");
    const novNow = DateTime.fromISO("2026-10-20T12:00", { zone: ZONE }).toMillis();
    const t = evaluateOpenTime(pasteSnapshot(rowFor(open, nov), novNow), { pack: nov, line: l, carryIn: [], elections: NO_ELECTIONS, banks: {}, giveUp: giveUp("trade", "PMU").giveUp, now: novNow }).trips[0];
    expect(sections(t, "no")).not.toContain("25.L.1.h");
  });

  it("CBA 2026 25.L.8.a: the trade limit, 13 CH from December 2026", () => {
    const fine = trip("213", 20, { credit: 23 });
    const over = trip("214", 22, { credit: 24 });
    const p = pack([l], [fine, over]);
    expect(sections(only(board(p, rowFor(fine, p), giveUp("trade"))), "no")).not.toContain("25.L.8.a");
    expect(sections(only(board(p, rowFor(over, p), giveUp("trade"))), "no")).toContain("25.L.8.a");
    expect(sections(only(board(p, rowFor(fine, p), { ...giveUp("trade"), tradedSoFarCH: 1 })), "no")).toContain("25.L.8.a");
  });

  it("CBA 2026 25.L.8.b: a similar footprint is told apart from one staffing could stop", () => {
    const same = trip("213", 10, { report: "0900" });
    const p = pack([l], [same]);
    expect(sections(only(board(p, rowFor(same, p), giveUp("trade"))))).toContain("25.L.8.b");
    const other = trip("214", 20);
    const q = pack([l], [other]);
    expect(sections(only(board(q, rowFor(other, q), giveUp("trade"))), "check")).toContain("25.L.2.a");
  });

  describe("CBA 2026 25.L.3.b: the holiday no-drop", () => {
    // Day 24 of a pack from Nov 30 is Dec 24.
    const christmas = trip("100", 24, { credit: 10 });
    const m = line([christmas]);
    const open = trip("213", 3);
    const p = pack([m], [open]);
    const on = (as: "trade" | "drop") => ({ line: m, giveUp: { key: tripKey(christmas), as, assignedAs: "LINE" as const } });
    it("rules out a drop", () => {
      const t = only(board(p, rowFor(open, p), on("drop")));
      expect(t.verdict).toBe("no");
      expect(sections(t, "no")).toContain("25.L.3.b");
    });
    it("only flags a trade: the text says drop", () => {
      const t = only(board(p, rowFor(open, p), on("trade")));
      expect(sections(t, "no")).not.toContain("25.L.3.b");
      expect(sections(t, "check")).toContain("25.L.3.b");
    });
  });

  it("CBA 2026 25.L.3.d: a contingency drop asks for a bank that covers the trip", () => {
    const open = trip("213", 20, { credit: 12 });
    const p = pack([l], [open]);
    expect(sections(only(board(p, rowFor(open, p), { ...giveUp("drop"), banks: { "M/U": 12 } })), "note")).toContain("25.L.3.d");
    expect(sections(only(board(p, rowFor(open, p), giveUp("drop"))), "check")).toContain("25.L.3.d");
  });
});

describe("CBA 2026 25.G.2.b.iii on a trip", () => {
  it("frozen can't be taken", () => {
    const open = trip("213", 10);
    const p = pack([], [open]);
    expect(sections(only(board(p, `${rowFor(open, p)} FROZEN`)), "no")).toContain("25.G.2.b.iii");
  });
});

describe("CBA 2026 25.L.1.a from August 2027", () => {
  const open = trip("213", 20);
  const p = pack([], [open], "AUG27");
  const row = rowFor(open, p);
  const at = (hhmm: string) => DateTime.fromISO(`2027-07-27T${hhmm}`, { zone: ZONE }).toMillis();
  const run = (now: number) => evaluateOpenTime(pasteSnapshot(row, now), { pack: p, line: null, carryIn: [], elections: NO_ELECTIONS, banks: {}, now }).trips[0];
  it("shows the hold in its hour, and straight-through outside it", () => {
    expect(sections(run(at("07:30")))).toContain("25.L.1.a.i");
    expect(sections(run(at("12:00")))).toContain("25.L.1.a.ii");
  });
  it("a countdown comes from a source that knows when the trip appeared", () => {
    const snapshot: OpenTimeSnapshot = { source: "test", readAt: at("07:30"), rows: [{ raw: row, tripNumbers: ["213"], month: Number(row.split(" ")[1].split("/")[0]), day: Number(row.split(" ")[1].split("/")[1]), appearedAt: at("07:28") }], unread: [], headings: [] };
    const t = evaluateOpenTime(snapshot, { pack: p, line: null, carryIn: [], elections: NO_ELECTIONS, banks: {}, now: at("07:30") }).trips[0];
    expect(t.findings.find((f) => f.section === "25.L.1.a.i")?.text).toContain("07:33:00");
  });
  it("isn't mentioned before August 2027", () => {
    const q = pack([], [trip("213", 20)]);
    expect(sections(only(board(q, rowFor(q.openPairings![0], q))))).not.toContain("25.L.1.a.i");
  });
});

describe("the score", () => {
  const mine = trip("100", 10);
  const others = [line([trip("1", 2, { credit: 40, tafb: 60 }), trip("2", 15, { credit: 30, tafb: 50 })], "1002"), line([trip("3", 8, { credit: 20 })], "1003"), line([trip("4", 4, { credit: 10 }), trip("5", 20, { credit: 10 })], "1004"), line([trip("6", 1, { credit: 60, tafb: 100 })], "1005"), line([trip("7", 22, { credit: 15 })], "1006"), line([trip("8", 12, { credit: 25, tafb: 40 })], "1007")];
  const l = line([mine]);
  const big = trip("213", 18, { credit: 30, tafb: 40 });
  const small = trip("214", 22, { credit: 8, tafb: 10 });
  const clash = trip("215", 10);
  const p = pack([l, ...others], [big, small, clash]);
  const text = [big, small, clash].map((t) => rowFor(t, p)).join("\n");

  it("gives every trip a score out of 100, on the pilot's own model", () => {
    const b = board(p, text, { line: l, model });
    expect(b.scored).toBe(true);
    for (const t of b.trips) {
      expect(t.fit).not.toBeNull();
      expect(t.fit!).toBeGreaterThanOrEqual(0);
      expect(t.fit!).toBeLessThanOrEqual(100);
    }
  });

  it("scores what can't be taken, but lists it last", () => {
    const b = board(p, text, { line: l, model });
    expect(b.trips.at(-1)?.key).toBe(tripKey(clash));
    expect(b.trips.at(-1)?.verdict).toBe("no");
    expect(b.trips.at(-1)?.fit).not.toBeNull();
    expect(b.trips.at(-1)?.monthEffect).toBeNull();
  });

  it("best fit first, among what can be taken", () => {
    const fits = board(p, text, { line: l, model }).trips.filter((t) => t.verdict !== "no").map((t) => t.fit!);
    expect(fits).toEqual([...fits].sort((a, b) => b - a));
  });

  it("gives its reasons, days off first", () => {
    const t = board(p, text, { line: l, model }).trips[0];
    expect(t.reasons[0]).toMatch(/days? off/);
  });

  it("says when it keeps the longest stretch off, and when it cuts it", () => {
    const b = board(p, text, { line: l, model });
    expect(b.trips.find((t) => t.key === tripKey(small))?.reasons[0]).toMatch(/^(keeps your|cuts your)/);
  });

  it("no model: no number, sorted by days off left, and the board says why", () => {
    const b = board(p, text, { line: l });
    expect(b.scored).toBe(false);
    expect(b.trips.every((t) => t.fit === null)).toBe(true);
    const days = b.trips.filter((t) => t.verdict !== "no").map((t) => t.daysOffAfter!);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  it("no line: the trip's own score, with no month to judge", () => {
    const b = board(p, text, { model });
    const t = b.trips.find((x) => x.key === tripKey(big))!;
    expect(t.monthEffect).toBeNull();
    expect(t.fit).toBe(Math.round(t.tripScore!));
  });

  it("the median trip's month doesn't move its score", () => {
    const b = board(p, text, { line: l, model });
    expect(b.trips.filter((t) => t.verdict !== "no").map((t) => t.monthEffect!).reduce((a, m) => a + m, 0)).toBeCloseTo(0, 6);
  });
});

describe("the commute, on the same answers the commute filter keeps", () => {
  const settings = { homeAirport: "DEN", arriveBeforeReportHours: 2, releaseToDepartureHours: 1, jumpseats: false };
  const open = trip("213", 10);
  const p = pack([], [open]);

  it("nothing asked: no claim about it", () => {
    const t = only(board(p, rowFor(open, p), { commute: { settings, answers: {} } }));
    expect(t.commute?.in).toBe("unknown");
    expect(t.reasons.join(" ")).not.toContain("commutable");
  });

  it("names the flight that makes it", () => {
    const report = DateTime.fromISO(START.DEC26, { zone: ZONE }).plus({ days: 10 }).set({ hour: 8 });
    const leave = report.minus({ hours: 5 }).set({ minute: 10 });
    const t = only(board(p, rowFor(open, p), { commute: { settings, answers: { [`${tripKey(open)}:toBase`]: { lastDeparture: leave.toMillis(), firstArrival: null } } } }));
    expect(t.commute?.in).toBe("yes");
    expect(t.reasons.join(" ")).toContain(`commutable on the ${leave.setZone("America/Denver").toFormat("HH:mm")}`);
  });

  it("a trip right after one the pilot has needs no commute in", () => {
    const mine = trip("100", 9, { tafb: 10, report: "0800" });
    const l = line([mine]);
    const next = trip("213", 9, { report: "2000", tafb: 10 });
    const q = pack([l], [next]);
    const t = only(board(q, rowFor(next, q), { line: l, commute: { settings, answers: {} } }));
    expect(t.commute?.in).toBe("joined");
  });
});

describe("a future source", () => {
  const open = trip("213", 10);
  const p = pack([], [open]);

  it("gives the same answer as a paste of the same trips", () => {
    const fromPaste = board(p, rowFor(open, p), { model });
    const snapshot: OpenTimeSnapshot = { source: "something else", readAt: NOW, rows: [{ raw: "whatever it says", tripNumbers: ["213"], month: fromPaste.trips[0].row.month, day: fromPaste.trips[0].row.day }], unread: [], headings: [] };
    const fromElsewhere = evaluateOpenTime(snapshot, { pack: p, line: null, carryIn: [], elections: NO_ELECTIONS, banks: {}, now: NOW, model });
    expect(fromElsewhere.trips.map((t) => [t.key, t.fit, t.verdict])).toEqual(fromPaste.trips.map((t) => [t.key, t.fit, t.verdict]));
  });
});

describe("the made-up list", () => {
  it("runs through the engine, and shows each kind of row it can't use", () => {
    const opens = [trip("213", 10), trip("214", 12), trip("215", 14), trip("216", 16)];
    const p = pack([], opens);
    const b = board(p, samplePaste(p));
    expect(b.trips.map((t) => t.key).sort()).toEqual(opens.map(tripKey).sort());
    expect(b.notInPack).toHaveLength(1);
    expect(b.unread.map((u) => u.raw)).toContain("BAS 0800-2000 Tuesday");
    expect(b.unread.map((u) => u.raw)).toContain("TRIP ?? sometime next week");
    expect(samplePaste(p)).toContain("made-up");
  });
});
