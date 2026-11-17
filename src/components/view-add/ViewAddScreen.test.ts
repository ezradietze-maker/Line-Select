import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Plan, ViewAddScreen } from "@/components/view-add/ViewAddScreen";
import type { ViewAddChoice, ViewAddPlan } from "@/lib/view-add";
import type { BidPack } from "@/types/bidpack";

const choice = (n: number): ViewAddChoice => ({ trip: null, text: `${100 + n} 14OCT`, creditHours: 6, daysOffAfter: 14, why: "Fits.", check: [], inBest: false, score: null }) as ViewAddChoice;
const plan = (choices: number): ViewAddPlan =>
  ({ flown: { dropped: [] }, targetCH: 0, overCH: 0, combos: [], choices: Array.from({ length: choices }, (_, i) => choice(i)), ruledOut: [], notRead: [], notInPack: [], dateChecks: [], fromPackOnly: false, byModel: false }) as unknown as ViewAddPlan;

describe("View/Add, printed", () => {
  it("prints the list it built, not a page with only the notes on it", () => {
    const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines: [], openPairings: [] } as unknown as BidPack;
    const html = renderToStaticMarkup(createElement(ViewAddScreen, { bidPack: pack, seniority: null, profile: null, userId: null, onGoToUpload: () => {} }));
    const section = html.match(/<section aria-label="View\/Add list"[^>]*>/)?.[0] ?? "";
    expect(section).not.toBe("");
    expect(section).not.toContain("print:hidden");
  });

  // Round 24: credit read in tenths here, as nowhere else: 24:20 read 24.3 and 6:50 read 6.8.
  it("says credit as the pack prints it, H:MM", () => {
    const p = { ...plan(1), targetCH: 24 + 20 / 60, combos: [{ trips: [{ pairingNumber: "501" }], totalCH: 17.5, shortCH: 6 + 50 / 60, daysOffAfter: 12, longestOff: null, workStretches: null, score: null }, { trips: [{ pairingNumber: "502" }], totalCH: 13.25, shortCH: 11, daysOffAfter: 13, longestOff: null, workStretches: null, score: null }], flown: { dropped: [{ trip: { pairingNumber: "213" }, makeUpCH: 24 + 20 / 60 }] } } as unknown as ViewAddPlan;
    const text = renderToStaticMarkup(createElement(Plan, { plan: p })).replace(/<[^>]+>/g, "");
    expect(text).toContain("trip 213 (24:20 CH)");
    expect(text).toContain("trip 501, 17:30 CH, 6:50 CH short of your 24:20");
    expect(text).toContain("trip 502 (13:15 CH, 13 days off)");
    expect(text).not.toMatch(/\d\.\d CH/);
  });

  // Round 28: a trip number flies on several dates, and the ruled-out list named only the number: B777 ANC CAP line
  // 1015 read "trip 60: Only 1:15 from trip 63" and "trip 60: It overlaps trip 146", with no way to tell which was which.
  it("dates each ruled-out trip, as the list of choices does", () => {
    const pack = { base: "MEM", bidPeriodStart: "2026-09-28" } as unknown as BidPack;
    const trip = (startDayIndex: number) => ({ id: "t60", pairingNumber: "60", startDayIndex, schedule: [{ reportTimeLocal: "0900", legs: [{ startMinutes: 60 }] }] });
    const p = { ...plan(0), ruledOut: [{ trip: trip(4), why: "Only 1:15 from trip 63." }, { trip: trip(25), why: "It overlaps trip 146." }] } as unknown as ViewAddPlan;
    const text = renderToStaticMarkup(createElement(Plan, { plan: p, pack })).replace(/<[^>]+>/g, "");
    expect(text).toContain("trip 60 Oct 2: Only 1:15 from trip 63.");
    expect(text).toContain("trip 60 Oct 23: It overlaps trip 146.");
  });

  it("prints every choice, past the 15 the screen shows before Show all", () => {
    const html = renderToStaticMarkup(createElement(Plan, { plan: plan(20) }));
    for (let n = 0; n < 20; n++) expect(html).toContain(`${100 + n} 14OCT`);
    // The 16th on is off the screen until Show all, but on the sheet.
    expect(html.match(/class="text-xs text-ink-muted hidden print:block"/g)).toHaveLength(5);
  });
});
