import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VacationSlideReminder } from "@/components/results/SendToVipsDialog";
import type { BidPack } from "@/types/bidpack";

const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines: [], bidCalendar: [] } as unknown as BidPack;

describe("Send to VIPS: after the award, ask for the vacation's slide", () => {
  it("names the top lines it's slid on and how far, and says the bid can't ask for it", () => {
    const html = renderToStaticMarkup(createElement(VacationSlideReminder, { pack, slides: new Map([["1012", 4], ["1040", -2], ["1099", 1]]), order: ["1012", "1005", "1040"] })).replace(/<[^>]+>/g, " ");
    expect(html).toContain("slid on 2 of your top 3 lines");
    expect(html).toContain("1012: 4 days later");
    expect(html).toContain("1040: 2 days earlier");
    expect(html).not.toContain("1099");
    expect(html).toContain("Conflict Input Window");
  });
});
