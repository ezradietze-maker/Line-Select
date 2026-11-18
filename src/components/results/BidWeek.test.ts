import { describe, expect, it } from "vitest";
import { bidWeekEvents, eventWhen, timeUntil } from "@/components/results/BidWeek";
import { parseBidCalendarPage } from "@/lib/pdf-parser/bid-calendar-parser";
import type { ExtractedPage } from "@/lib/pdf-parser/text-extraction";
import cover from "@/lib/pdf-parser/fixtures/bid-calendar-oct26-md11-mem.json";

const bidCalendar = parseBidCalendarPage(cover as ExtractedPage);

describe("how long until a bid date", () => {
  it("reads in days and hours, then hours and minutes, then minutes", () => {
    expect(timeUntil((2 * 24 + 4) * 3_600_000 + 10 * 60_000)).toBe("in 2d 4h");
    expect(timeUntil(3 * 3_600_000 + 20 * 60_000)).toBe("in 3h 20m");
    expect(timeUntil(12 * 60_000)).toBe("in 12m");
    expect(timeUntil(10_000)).toBe("in 1m");
  });
});

describe("when a bid date falls", () => {
  it("is in Memphis time for the windows set in CT, and the base's own time for open time and secondary lines", () => {
    expect(eventWhen({ at: "2026-09-08T17:00:00.000Z", kind: "bid-close" }, "ANC")).toBe("Tue Sep 8, 12:00 CT");
    expect(eventWhen({ at: "2026-09-25T05:15:00.000Z", kind: "open-time" }, "ANC")).toBe("Thu Sep 24, 21:15 ANC");
  });
});

describe("the bid week's dates", () => {
  it("are this bid's alone, in order, though the cover prints the next bid's too", () => {
    const events = bidWeekEvents({ id: "p", month: "OCT26", base: "MEM", seat: "CAP", bidCalendar }, null);
    expect(events.length).toBeGreaterThan(5);
    expect(events.every((e) => e.bidMonth === "OCT26")).toBe(true);
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort());
    expect(events[0].kind).toBe("bid-close");
  });
});
