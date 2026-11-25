import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VacationSlideReminder } from "@/components/results/SendToVipsDialog";
import type { BidPack } from "@/types/bidpack";

const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines: [], bidCalendar: [] } as unknown as BidPack;
const slid = (offset: number) => ({ offsets: { v: offset } });
const render = (slides: Map<string, ReturnType<typeof slid>>, order: string[]) => renderToStaticMarkup(createElement(VacationSlideReminder, { pack, slides, order })).replace(/<[^>]+>/g, " ");

describe("Send to VIPS: after the award, ask for the vacation's slide", () => {
  it("names the top lines it's slid on and how far, and says the bid can't ask for it", () => {
    const html = render(new Map([["1012", slid(4)], ["1040", slid(-2)], ["1099", slid(1)]]), ["1012", "1005", "1040"]);
    expect(html).toContain("slid on 2 of your top 3 lines");
    expect(html).toContain("1012: 4 days later");
    expect(html).toContain("1040: 2 days earlier");
    expect(html).not.toContain("1099");
    expect(html).toContain("Conflict Input Window");
  });

  it("names an expansion too (CBA 2026 7.E.3): the line was ranked with it, and it's asked for in the same window", () => {
    const html = render(new Map([["1012", { offsets: { v: 0 }, expand: { v: { before: 0, after: 8 } } }], ["1040", { offsets: { v: 2 }, expand: { v: { before: 3, after: 0 } } }]]), ["1012", "1040"]);
    expect(html).toContain("slid or expanded on 2 of your top 2 lines");
    expect(html).toContain("1012: expanded 8 days later");
    expect(html).toContain("1040: 2 days later, expanded 3 days earlier");
    expect(html).toContain("slide or expansion");
  });
});
