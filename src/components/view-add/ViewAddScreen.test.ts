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

  it("prints every choice, past the 15 the screen shows before Show all", () => {
    const html = renderToStaticMarkup(createElement(Plan, { plan: plan(20) }));
    for (let n = 0; n < 20; n++) expect(html).toContain(`${100 + n} 14OCT`);
    // The 16th on is off the screen until Show all, but on the sheet.
    expect(html.match(/class="text-xs text-ink-muted hidden print:block"/g)).toHaveLength(5);
  });
});
