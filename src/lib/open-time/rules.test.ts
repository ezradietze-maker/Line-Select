import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { contractNode, fullText } from "@/lib/contract";
import { applicabilityOf } from "@/lib/contract/phases";
import { normalizeForMatch } from "@/lib/contract/validate";
import { banksFor, checkAssignedAs, checkContingency, checkDeadline, checkDrop, checkFrozen, checkPriority, checkRDays, checkRealTime, checkStaffing, checkTradeLimit, isSimilarFootprint, noDropDayIn, openTimeRules, priorityGuaranteedUntil, realTimeTiming, submissionDeadline } from "@/lib/open-time/rules";

const ZONE = "America/Chicago";
const HOUR = 3_600_000;
const at = (iso: string, zone = ZONE) => DateTime.fromISO(iso, { zone }).toMillis();
const span = (from: string, to: string, zone = ZONE) => ({ start: at(from, zone), end: at(to, zone) });

const NOV = openTimeRules("NOV26");
const DEC = openTimeRules("DEC26");

/** The quote really is the contract's text, in the wording of that year. */
function quotes(section: string, words: string, version: "2026" | "2015" = "2026") {
  expect(contractNode(section), section).toBeDefined();
  expect(normalizeForMatch(fullText(section, version))).toContain(normalizeForMatch(words));
}

describe("phases follow the Implementation LOA's chart", () => {
  // The months each rule switches on are read against the contract's own chart, so a typo in either shows up here.
  it.each([
    ["25.L.1.h", "2026-11", false],
    ["25.L.1.h", "2026-12", true],
    ["25.L.4.d", "2026-11", false],
    ["25.L.4.d", "2026-12", true],
    ["25.L.5.c", "2026-12", true],
    ["25.L.6.e", "2026-11", false],
    ["25.L.6.e", "2026-12", true],
    ["25.L.8.a", "2026-11", false],
    ["25.L.8.a", "2026-12", true],
    ["25.L.1.a", "2027-07", false],
    ["25.L.1.a", "2027-08", true],
    ["25.L.6.b.vii", "2027-09", false],
    ["25.L.6.b.vii", "2027-10", true],
  ] as const)("%s in %s: in force %s", (section, month, inForce) => {
    const a = applicabilityOf(section, month);
    expect(a.kind).toBe("scheduled");
    if (a.kind === "scheduled") expect(a.inForce).toBe(inForce);
  });
  it("our switches agree", () => {
    expect([NOV.overageCH, DEC.overageCH]).toEqual([6, 7]);
    expect([NOV.tradeNetCH, DEC.tradeNetCH]).toEqual([12, 13]);
    expect([NOV.lockedCodes.includes("PMU"), DEC.lockedCodes.includes("PMU")]).toEqual([false, true]);
    expect([openTimeRules("JUL27").realTime, openTimeRules("AUG27").realTime]).toEqual([false, true]);
    expect([openTimeRules("SEP27").bankOrder.includes("SMU"), openTimeRules("OCT27").bankOrder.includes("SMU")]).toEqual([false, true]);
  });
});

describe('CBA 2026 25.L.1.b: "no later than 0900 LBT on the day before the first affected activity"', () => {
  it("quotes the contract", () => {
    quotes("25.L.1.b", "Submissions for open time trips (e.g., PMU, make-up or trip trade), and submissions to drop a trip shall be submitted no later than 0900 LBT on the day before the first affected activity.");
    quotes("25.L.1.b", "When submitted later than 0900 LBT on the applicable day, such submission may be processed at the Company's discretion.");
  });
  it("is 0900 base time the day before", () => {
    expect(submissionDeadline(at("2026-10-15T14:00"), ZONE)).toBe(at("2026-10-14T09:00"));
  });
  it("counts the day in base days: a 0030 show belongs to the day before (25.A.2)", () => {
    quotes("25.A.2", "The Company shall not change the start time of any local base day, except EUR, to any start time other than 0130 LBT");
    expect(submissionDeadline(at("2026-10-15T00:30"), ZONE)).toBe(at("2026-10-13T09:00"));
    expect(submissionDeadline(at("2026-10-15T01:30"), ZONE)).toBe(at("2026-10-14T09:00"));
  });
  it("uses the base's own time", () => {
    const anchorage = "America/Anchorage";
    expect(submissionDeadline(at("2026-10-15T14:00", anchorage), anchorage)).toBe(at("2026-10-14T09:00", anchorage));
  });
  it("before it: the deadline to meet. After it: the Company's discretion, not a no", () => {
    const show = at("2026-10-15T14:00");
    expect(checkDeadline(show, at("2026-10-14T08:59"), ZONE)[0]).toMatchObject({ level: "note", section: "25.L.1.b" });
    expect(checkDeadline(show, at("2026-10-14T09:01"), ZONE)[0]).toMatchObject({ level: "late", section: "25.L.1.b" });
  });
  it("a trip that's started is gone", () => {
    const show = at("2026-10-15T14:00");
    expect(checkDeadline(show, show + 1, ZONE)[0].level).toBe("no");
  });
});

describe('CBA 2026 25.L.1.h: "may not trade, proffer, or drop a trip assigned as"', () => {
  it("quotes both years' wording", () => {
    quotes("25.L.1.h", "A pilot may not trade, proffer, or drop a trip assigned as VLT, DRF, AVA, CMU, PDO, PMU, or RSV.");
    quotes("25.L.1.h", "A pilot may not trade, proffer, or drop a trip assigned as VLT, DRF, AVA, CMU, PDO, or RSV.", "2015");
  });
  it.each(["VLT", "DRF", "AVA", "CMU", "PDO", "RSV"] as const)("%s can't move, in any bid period", (code) => {
    expect(checkAssignedAs(code, NOV)[0]).toMatchObject({ level: "no", section: "25.L.1.h" });
    expect(checkAssignedAs(code, DEC)[0].level).toBe("no");
  });
  it("PMU can't move from December 2026, and could before it", () => {
    expect(checkAssignedAs("PMU", NOV)).toEqual([]);
    expect(checkAssignedAs("PMU", DEC)[0]).toMatchObject({ level: "no", section: "25.L.1.h" });
  });
  it("a trip on the awarded line can", () => {
    expect(checkAssignedAs("LINE", DEC)).toEqual([]);
  });
});

describe('CBA 2026 25.L.3.b: "may not drop a trip or R-day that is scheduled in whole or in part on"', () => {
  it("quotes the contract", () => {
    quotes("25.L.3.b", "A pilot may not drop a trip or R-day that is scheduled in whole or in part on the following days (i.e. base days): New Year's Eve, New Year's Day, Thanksgiving Day, Christmas Eve or Christmas Day.");
  });
  it.each([
    ["New Year's Eve", "2026-12-31T10:00", "2026-12-31T20:00"],
    ["New Year's Day", "2027-01-01T10:00", "2027-01-01T20:00"],
    ["Thanksgiving Day", "2026-11-26T10:00", "2026-11-26T20:00"],
    ["Thanksgiving Day", "2027-11-25T10:00", "2027-11-25T20:00"],
    ["Christmas Eve", "2026-12-24T10:00", "2026-12-24T20:00"],
    ["Christmas Day", "2026-12-25T10:00", "2026-12-25T20:00"],
  ])("%s", (name, from, to) => {
    expect(noDropDayIn(span(from, to), ZONE)).toBe(name);
    expect(checkDrop(span(from, to), ZONE)[0]).toMatchObject({ level: "no", section: "25.L.3.b" });
  });
  it("in part counts: a trip that only touches the day", () => {
    expect(noDropDayIn(span("2026-12-22T10:00", "2026-12-24T03:00"), ZONE)).toBe("Christmas Eve");
  });
  it("base days: 0030 on Christmas Eve is still the 23rd's, 0030 on the 26th is still Christmas Day's", () => {
    expect(noDropDayIn(span("2026-12-23T10:00", "2026-12-24T00:30"), ZONE)).toBeNull();
    expect(noDropDayIn(span("2026-12-26T00:30", "2026-12-26T10:00"), ZONE)).toBe("Christmas Day");
    expect(noDropDayIn(span("2026-12-26T02:00", "2026-12-26T10:00"), ZONE)).toBeNull();
  });
  it("every other day can be dropped", () => {
    expect(noDropDayIn(span("2026-11-25T10:00", "2026-11-25T20:00"), ZONE)).toBeNull();
    expect(checkDrop(span("2026-10-14T10:00", "2026-10-15T20:00"), ZONE)).toEqual([]);
  });
});

describe('CBA 2026 25.L.4.b, 25.L.5.a: priority "guaranteed only for" submissions "prior to 0900 LBT, at least 48 hours prior to the showtime"', () => {
  it("quotes the contract", () => {
    quotes("25.L.4.b", "This priority is guaranteed only for PMU submissions made prior to 0900 LBT, at least 48 hours prior to the showtime of the identified trip.");
    quotes("25.L.5.a", "This priority is guaranteed only for PNP submissions made prior to 0900 LBT, at least 48 hours prior to the showtime of the identified trip or standby.");
    quotes("25.L.4.b", "but not for a trip which the pilot rejected as a substitution assignment");
  });
  it("is the last 0900 LBT that's still 48 hours ahead", () => {
    expect(priorityGuaranteedUntil(at("2026-10-15T14:00"), ZONE)).toBe(at("2026-10-13T09:00"));
    expect(priorityGuaranteedUntil(at("2026-10-15T08:00"), ZONE)).toBe(at("2026-10-12T09:00"));
  });
  it("past it, the trip's still there but the priority isn't guaranteed", () => {
    const show = at("2026-10-15T14:00");
    expect(checkPriority("PMU", show, at("2026-10-13T08:00"), ZONE)).toMatchObject({ level: "note", section: "25.L.4.b" });
    expect(checkPriority("PNP", show, at("2026-10-13T09:00"), ZONE)).toMatchObject({ level: "check", section: "25.L.5.a" });
  });
  it("names PMU's rule against a substitution it rejected", () => {
    expect(banksFor(10, { PMU: 10 }, DEC)[0].notes.join(" ")).toContain("25.L.4.b");
  });
});

describe('CBA 2026 25.L.4.d: PMU "exceeds the pilot\'s OTP eligibility by more than 7 CH"', () => {
  it("quotes both years' wording", () => {
    quotes("25.L.4.d", "The pilot is not eligible for a PMU assignment that exceeds the pilot's OTP eligibility by more than 7 CH.");
    quotes("25.L.4.d", "by more than 6 CH", "2015");
  });
  it("7 CH over is fine from December 2026, and more isn't", () => {
    expect(banksFor(17, { PMU: 10 }, DEC)[0]).toMatchObject({ code: "PMU", eligible: true, section: "25.L.4.d" });
    expect(banksFor(17.01, { PMU: 10 }, DEC)[0].eligible).toBe(false);
  });
  it("6 CH before it", () => {
    expect(banksFor(16, { PMU: 10 }, NOV)[0].eligible).toBe(true);
    expect(banksFor(17, { PMU: 10 }, NOV)[0].eligible).toBe(false);
  });
  it("from December 2026 a PMU trip can't be dropped later, and that's said up front (25.L.1.h)", () => {
    expect(banksFor(10, { PMU: 10 }, DEC)[0].notes.join(" ")).toContain("25.L.1.h");
    expect(banksFor(10, { PMU: 10 }, NOV)[0].notes.join(" ")).not.toContain("25.L.1.h");
  });
});

describe('CBA 2026 25.L.5.c: PNP "exceeds the pilot\'s PNP eligibility by more than 7 CH"', () => {
  it("quotes both years' wording", () => {
    quotes("25.L.5.c", "The pilot is not eligible for a PNP assignment that exceeds the pilot's PNP eligibility by more than 7 CH.");
    quotes("25.L.5.c", "by more than 6 CH", "2015");
  });
  it("switches at December 2026", () => {
    expect(banksFor(17, { PNP: 10 }, DEC)[0]).toMatchObject({ eligible: true, section: "25.L.5.c" });
    expect(banksFor(17, { PNP: 10 }, NOV)[0].eligible).toBe(false);
  });
  it('25.L.5.d: "If a PNP trip is dropped ... those CH revert to general make up (M/U)."', () => {
    quotes("25.L.5.d", "If a PNP trip is dropped as provided in Section 25.L.3.a., those CH revert to general make up (M/U).");
    expect(banksFor(10, { PNP: 10 }, DEC)[0].notes.join(" ")).toContain("25.L.5.d");
  });
});

describe('CBA 2026 25.L.6: make-up, "by more than 7 CH", under "a single pay code", in order', () => {
  it("quotes the contract", () => {
    quotes("25.L.6.e", "A pilot is not eligible for a make-up assignment that exceeds the pilot's make-up eligibility by more than 7 CH.");
    quotes("25.L.6.e", "by more than 6 CH", "2015");
    quotes("25.L.6.d", "A make-up assignment shall be operated under a single pay code (e.g., one trip could not be half MUV and half MUS).");
    quotes("25.L.6.b.vii", "Submissions for make-up shall be processed in the following order: CMU, SMU, M/U, MUS, MUV and AFB.");
    quotes("25.L.6.b.vii", "Submissions for make-up shall be processed in the following order: CMU, M/U, MUS, MUV and AFB.", "2015");
    quotes("25.L.6.f", "If a SMU trip is dropped as provided in Section 25.L.3.a., those CH revert to general make up (M/U).");
  });
  it("25.L.6.e: switches at December 2026, and the edge counts", () => {
    expect(banksFor(17, { "M/U": 10 }, DEC)[0]).toMatchObject({ eligible: true, section: "25.L.6.e" });
    expect(banksFor(17, { "M/U": 10 }, NOV)[0].eligible).toBe(false);
    expect(banksFor(16, { "M/U": 10 }, NOV)[0].eligible).toBe(true);
    expect(banksFor(0.1 + 0.2 + 7, { MUV: 0.3 }, DEC)[0].eligible).toBe(true);
  });
  it("25.L.6.d: banks aren't added together", () => {
    const options = banksFor(20, { MUV: 6, MUS: 6 }, DEC);
    expect(options.map((o) => o.eligible)).toEqual([false, false]);
  });
  it("25.L.6.b.vii, 25.G.3.b: priority first, then the make-up order", () => {
    quotes("25.G.3.b.i", "SUB, RAT or PMU");
    quotes("25.G.3.b.ii", "PNP");
    const all = { AFB: 5, MUV: 5, MUS: 5, "M/U": 5, CMU: 5, PNP: 5, PMU: 5, SMU: 5 };
    expect(banksFor(5, all, DEC).map((o) => o.code)).toEqual(["PMU", "PNP", "CMU", "M/U", "MUS", "MUV", "AFB"]);
    expect(banksFor(5, all, openTimeRules("OCT27")).map((o) => o.code)).toEqual(["PMU", "PNP", "CMU", "SMU", "M/U", "MUS", "MUV", "AFB"]);
  });
  it("25.L.6.f: says where SMU's hours go, from October 2027", () => {
    expect(banksFor(5, { SMU: 5 }, openTimeRules("OCT27"))[0].notes.join(" ")).toContain("25.L.6.f");
  });
  it("25.L.1.h: a CMU trip can't be dropped later, in any bid period", () => {
    expect(banksFor(5, { CMU: 5 }, NOV)[0].notes.join(" ")).toContain("25.L.1.h");
  });
  it("a bank with nothing in it isn't offered", () => {
    expect(banksFor(5, { "M/U": 0, MUS: undefined }, DEC)).toEqual([]);
  });
});

describe('CBA 2026 25.L.7: "Submissions for AFB shall be administered as provided in Section 25.L.6."', () => {
  it("quotes the contract", () => {
    quotes("25.L.7", "Submissions for AFB shall be administered as provided in Section 25.L.6.");
  });
  it("takes make-up's limit", () => {
    expect(banksFor(17, { AFB: 10 }, DEC)[0]).toMatchObject({ eligible: true, section: "25.L.7" });
    expect(banksFor(17.5, { AFB: 10 }, DEC)[0].eligible).toBe(false);
  });
});

describe('CBA 2026 25.L.8.a: "may not increase the pilot\'s BLG, as published, by more than 13 CH"', () => {
  it("quotes both years' wording", () => {
    quotes("25.L.8.a", "The net effect of any trade(s) in a bid period (including similar footprint trades, as described in Section 25.L.8.b.) may not increase the pilot's BLG, as published, by more than 13 CH.");
    quotes("25.L.8.a", "by more than 12 CH", "2015");
  });
  it("13 CH from December 2026, 12 CH before it", () => {
    expect(checkTradeLimit(23, 10, 0, DEC)[0].level).toBe("note");
    expect(checkTradeLimit(23.5, 10, 0, DEC)[0]).toMatchObject({ level: "no", section: "25.L.8.a" });
    expect(checkTradeLimit(22, 10, 0, NOV)[0].level).toBe("note");
    expect(checkTradeLimit(23, 10, 0, NOV)[0].level).toBe("no");
  });
  it('"any trade(s) in a bid period": what earlier trades added counts', () => {
    expect(checkTradeLimit(15, 10, 8, DEC)[0].level).toBe("note");
    expect(checkTradeLimit(16, 10, 8, DEC)[0].level).toBe("no");
  });
  it("a trade down is fine", () => {
    expect(checkTradeLimit(5, 20, 0, DEC)[0].level).toBe("note");
  });
});

describe('CBA 2026 25.L.8.b: a "similar footprint" trade "shall be accepted"', () => {
  const given = { show: at("2026-10-15T09:00"), tafbHours: 30 };
  const now = at("2026-10-10T09:00");
  it("quotes the contract", () => {
    quotes("25.L.8.b.i", "The trade is submitted no later than 72 hours before the showtime of the trip(s) being placed into open time");
    quotes("25.L.8.b.ii.(a)", "On the same local base day");
    quotes("25.L.8.b.ii.(b)", "In the same reserve period as the original trip(s)");
    quotes("25.L.8.b.ii.(c)", "An equal to or greater TAFB than the original trip(s)");
    quotes("25.L.2.a", "that would place a trip(s) into open time in excess of the Max Open");
    quotes("25.M.2.a.ii", "Reserve Period A+ (RP-A+) is a 12 hour period of time beginning 6 hours after the start of the day.");
  });
  it("same base day, same reserve period, equal TAFB, 72 hours out", () => {
    expect(isSimilarFootprint({ show: at("2026-10-15T10:00"), tafbHours: 30 }, given, now, ZONE)).toBe(true);
  });
  it("i: not inside 72 hours", () => {
    expect(isSimilarFootprint({ show: at("2026-10-15T10:00"), tafbHours: 30 }, given, given.show - 71 * HOUR, ZONE)).toBe(false);
    expect(isSimilarFootprint({ show: at("2026-10-15T10:00"), tafbHours: 30 }, given, given.show - 72 * HOUR, ZONE)).toBe(true);
  });
  it("ii.a: not another base day", () => {
    expect(isSimilarFootprint({ show: at("2026-10-16T09:00"), tafbHours: 30 }, given, now, ZONE)).toBe(false);
  });
  it("ii.b: not another reserve period", () => {
    // 0800 is RP-A only (0130–1330); 1400 is RP-A+ and RP-B: no period in common.
    expect(isSimilarFootprint({ show: at("2026-10-15T14:00"), tafbHours: 30 }, { show: at("2026-10-15T07:00"), tafbHours: 30 }, now, ZONE)).toBe(false);
  });
  it("ii.b: overlapping periods count as the same when they share one (a question for the ex-pilot)", () => {
    expect(isSimilarFootprint({ show: at("2026-10-15T12:00"), tafbHours: 30 }, { show: at("2026-10-15T08:00"), tafbHours: 30 }, now, ZONE)).toBe(true);
  });
  it("ii.c: not less TAFB, and more is fine", () => {
    expect(isSimilarFootprint({ show: at("2026-10-15T10:00"), tafbHours: 29 }, given, now, ZONE)).toBe(false);
    expect(isSimilarFootprint({ show: at("2026-10-15T10:00"), tafbHours: 50 }, given, now, ZONE)).toBe(true);
  });
  it("25.L.2.a: anything else can be denied on staffing, which we can't see", () => {
    expect(checkStaffing(true)).toMatchObject({ level: "note", section: "25.L.8.b" });
    expect(checkStaffing(false)).toMatchObject({ level: "check", section: "25.L.2.a" });
  });
});

describe('CBA 2026 25.L.3.d: a contingency needs "the applicable bank CHs sufficient to cover the trip(s)"', () => {
  it("quotes the contract", () => {
    quotes("25.L.3.d", "specifies a trip(s) or R-day(s) to drop only if the pilot is able to pick up a specific trip(s). The pilot must have the applicable bank CHs sufficient to cover the trip(s) the pilot submits to pick up.");
    quotes("25.L.3.c", "A pilot who drops a trip or R-day(s) shall be eligible for make-up.");
  });
  it("a bank that covers it is fine", () => {
    expect(checkContingency(10, banksFor(10, { "M/U": 10 }, DEC))[0]).toMatchObject({ level: "note", section: "25.L.3.d" });
  });
  it("one that doesn't is only flagged: the text doesn't say if the dropped hours count", () => {
    expect(checkContingency(10, banksFor(10, { "M/U": 2 }, DEC))[0]).toMatchObject({ level: "check", section: "25.L.3.d" });
    expect(checkContingency(10, [])[0].level).toBe("check");
  });
});

describe('CBA 2026 25.L.1.d: "prohibited if it would create a conflict with another scheduled activity"', () => {
  const rDays = span("2026-10-20T01:30", "2026-10-22T13:30");
  it("quotes the contract", () => {
    quotes("25.L.1.d", "A bid line adjustment is prohibited if it would create a conflict with another scheduled activity (e.g., trip, R-day, training)");
    quotes("25.L.1.d.i", "An R-day conflicts with an earlier assignment unless there are at least 12 hours prior to the start of the pilot's first RP");
    quotes("25.L.1.d.ii", "An R-day conflicts with a subsequent assignment unless there are at least 12 hours between the end of the pilot's R-day and the beginning of the scheduled assignment");
  });
  it("i: 12 hours clear before the first RP", () => {
    expect(checkRDays(span("2026-10-18T08:00", "2026-10-19T13:30"), rDays, "R-days")).toEqual([]);
    expect(checkRDays(span("2026-10-18T08:00", "2026-10-19T14:00"), rDays, "R-days")[0]).toMatchObject({ level: "no", section: "25.L.1.d" });
  });
  it("ii: 12 hours clear after the R-day", () => {
    expect(checkRDays(span("2026-10-23T01:30", "2026-10-24T08:00"), rDays, "R-days")).toEqual([]);
    expect(checkRDays(span("2026-10-23T01:00", "2026-10-24T08:00"), rDays, "R-days")[0].level).toBe("no");
  });
  it("on top of them, no", () => {
    expect(checkRDays(span("2026-10-21T08:00", "2026-10-21T20:00"), rDays, "R-days")[0].level).toBe("no");
  });
});

describe('CBA 2026 25.L.1.a.i: "shall remain in open time for 5 minutes", from August 2027', () => {
  const august = openTimeRules("AUG27");
  const published = at("2027-07-29T19:15");
  it("quotes the contract", () => {
    quotes("25.L.1.a.i", "For the first 12 hours after the publication of open time, and from 0700 LBT through 0800 LBT each day:");
    quotes("25.L.1.a.i", "A trip or standby that appears in open time shall remain in open time for 5 minutes");
    quotes("25.L.1.a.i", "unless a bid line adjustment is submitted using PMU, in which case it shall be automatically and immediately processed.");
    quotes("25.L.1.a.ii", "For any time period not covered by Section 25.L.1.a.i. above, a bid line adjustment submission shall be automatically and immediately processed, regardless of status.");
  });
  it("nothing before August 2027", () => {
    expect(realTimeTiming(at("2027-07-30T07:30"), ZONE, openTimeRules("JUL27"))).toBeNull();
    expect(checkRealTime(null, ZONE)).toEqual([]);
  });
  it("holds from 0700 through 0800 LBT each day", () => {
    expect(realTimeTiming(at("2027-08-10T06:59"), ZONE, august)?.mode).toBe("immediate");
    expect(realTimeTiming(at("2027-08-10T07:00"), ZONE, august)?.mode).toBe("hold");
    expect(realTimeTiming(at("2027-08-10T08:00"), ZONE, august)?.mode).toBe("hold");
    expect(realTimeTiming(at("2027-08-10T08:01"), ZONE, august)?.mode).toBe("immediate");
  });
  it("holds for the first 12 hours after publication", () => {
    expect(realTimeTiming(published + 11 * HOUR, ZONE, august, { publishedAt: published })?.mode).toBe("hold");
    expect(realTimeTiming(published + 13 * HOUR, ZONE, august, { publishedAt: published })?.mode).toBe("immediate");
  });
  it("PMU goes straight through", () => {
    expect(realTimeTiming(at("2027-08-10T07:30"), ZONE, august, { usingPMU: true })?.mode).toBe("immediate");
  });
  it("gives the countdown when the row says when it appeared (25.L.1.a.v), and doesn't invent one when it doesn't", () => {
    quotes("25.L.1.a.v", "The Company shall inform pilots of the time stamp for a trip or standby");
    const appearedAt = at("2027-08-10T07:02");
    const timing = realTimeTiming(at("2027-08-10T07:03"), ZONE, august, { appearedAt });
    expect(timing).toEqual({ mode: "hold", holdEndsAt: appearedAt + 5 * 60_000 });
    expect(checkRealTime(timing, ZONE)[0].text).toContain("07:07:00");
    expect(realTimeTiming(at("2027-08-10T07:03"), ZONE, august)).toEqual({ mode: "hold", holdEndsAt: null });
  });
  it("its five minutes up, a bid goes straight through", () => {
    expect(realTimeTiming(at("2027-08-10T07:08"), ZONE, august, { appearedAt: at("2027-08-10T07:02") })?.mode).toBe("immediate");
  });
});

describe('CBA 2026 25.G.2.b.iii: frozen, "available only to CRS"', () => {
  it("quotes the contract", () => {
    quotes("25.G.2.b.iii", "When a trip is frozen, it will be visible, but displayed in a manner indicating that it is available only to CRS.");
  });
  it("rules it out", () => {
    expect(checkFrozen(true)[0]).toMatchObject({ level: "no", section: "25.G.2.b.iii" });
    expect(checkFrozen(undefined)).toEqual([]);
  });
});
