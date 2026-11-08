import { describe, expect, it } from "vitest";
import { parseBidCalendarPage } from "@/lib/pdf-parser/bid-calendar-parser";
import type { ExtractedPage } from "@/lib/pdf-parser/text-extraction";
import cover from "@/lib/pdf-parser/fixtures/bid-calendar-oct26-md11-mem.json";

// The cover page of the real October 2026 MEM MD-11 pack, as positioned text (calendar only — no pilot data).
const page = cover as ExtractedPage;

describe("parseBidCalendarPage", () => {
  const events = parseBidCalendarPage(page);
  const find = (text: RegExp) => events.filter((e) => text.test(e.text));

  it("reads every event in both months' grids", () => {
    expect(events).toHaveLength(42);
  });

  it("puts each event on its own day, read by column, not by printed row", () => {
    expect(find(/^OCT26 Bid Opens/)).toEqual([{ date: "2026-09-03", text: "OCT26 Bid Opens 1700 CT", time: "17:00", zone: "CT" }]);
    expect(find(/^OCT26 Cap Bid Closes/)).toEqual([{ date: "2026-09-08", text: "OCT26 Cap Bid Closes 1200 CT", time: "12:00", zone: "CT" }]);
    expect(find(/^OCT26 F\/O Bid Closes/)[0]).toMatchObject({ date: "2026-09-09", time: "12:00", zone: "CT" });
    expect(find(/^OCT26 CAP Conflict Input Closes/)[0]).toMatchObject({ date: "2026-09-11", time: "07:00" });
    expect(find(/^OCT26 View\/Add Input Window Opens/)[0]).toMatchObject({ date: "2026-09-13", time: "07:00" });
  });

  it("splits two events in one day's cell at the blank line between them", () => {
    const sep24 = events.filter((e) => e.date === "2026-09-24").map((e) => e.text);
    expect(sep24).toEqual(["OT Release CAP 1915 LBT F/O 2115 LBT", "DEC26 ITU Training Bid Closes 0900 CT"]);
    expect(find(/^OT Release/)[0]).toMatchObject({ time: "19:15", zone: "LBT" });
  });

  it("carries the month across the grid's edges", () => {
    expect(find(/^JUL26 Expense/)[0].date).toBe("2026-08-30");
    expect(find(/^OCT26 Bid Month Starts/)[0].date).toBe("2026-09-28");
    expect(find(/^NOV26 Bid Opens/)[0].date).toBe("2026-10-01");
    expect(find(/^NOV26 Bid Month Starts/)[0].date).toBe("2026-10-26");
  });

  it("leaves the margin's week numbers out", () => {
    expect(events.some((e) => /^\d+$/.test(e.text))).toBe(false);
  });

  it("returns nothing for a page that isn't a bid calendar", () => {
    expect(parseBidCalendarPage({ pageNumber: 1, rotate: 0, width: 612, height: 792, items: [{ str: "Bid Information for MD11 MEM", x: 20, y: 20 }] })).toEqual([]);
  });
});
