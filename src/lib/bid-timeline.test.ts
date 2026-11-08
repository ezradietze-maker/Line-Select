import { describe, expect, it } from "vitest";
import { bidTimeline, timelineRules, type TimelineEvent, type TimelinePack } from "@/lib/bid-timeline";
import { parseBidCalendarPage } from "@/lib/pdf-parser/bid-calendar-parser";
import type { ExtractedPage } from "@/lib/pdf-parser/text-extraction";
import cover from "@/lib/pdf-parser/fixtures/bid-calendar-oct26-md11-mem.json";

function pack(over: Partial<TimelinePack> = {}): TimelinePack {
  return { id: "p", month: "OCT26", base: "MEM", seat: "CAP", ...over };
}

const printed = parseBidCalendarPage(cover as ExtractedPage);
const central = (at: string) => new Date(at).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const brief = (events: TimelineEvent[], month: string) => Object.fromEntries(events.filter((e) => e.bidMonth === month).map((e) => [e.kind, central(e.at)]));

describe("which rules a bid period uses (Implementation LOA, Phase 2)", () => {
  it("keeps the 2015 times for bids that close before the first day of the December 2026 bid period", () => {
    expect(timelineRules("NOV26")).toBe("2015");
    expect(timelineRules("DEC26")).toBe("2015");
  });

  it("uses the 2026 times from the first bid that closes after it", () => {
    expect(timelineRules("JAN27")).toBe("2026");
    expect(timelineRules("AUG27")).toBe("2026");
  });
});

describe("the timeline printed on the pack's cover", () => {
  it("gives a captain every step, on FedEx's own dates", () => {
    const events = bidTimeline(pack({ bidCalendar: printed }));
    expect(brief(events, "OCT26")).toEqual({
      "bid-close": "Tue, Sep 8, 12:00",
      "conflict-open": "Tue, Sep 8, 17:00",
      "conflict-close": "Fri, Sep 11, 07:00",
      "view-add-open": "Sun, Sep 13, 07:00",
      "view-add-close": "Tue, Sep 15, 07:00",
      "sww-open": "Wed, Sep 16, 12:00",
      "sww-close": "Mon, Sep 21, 07:00",
      "secondary-lines": "Wed, Sep 23, 17:00",
      "open-time": "Thu, Sep 24, 19:15",
    });
    expect(events.every((e) => e.source === "pack")).toBe(true);
  });

  it("gives a first officer their own close, conflict window and open time", () => {
    const events = bidTimeline(pack({ bidCalendar: printed, seat: "FO" }));
    expect(brief(events, "OCT26")).toMatchObject({
      "bid-close": "Wed, Sep 9, 12:00",
      "conflict-open": "Wed, Sep 9, 17:00",
      "conflict-close": "Sat, Sep 12, 07:00",
      "open-time": "Thu, Sep 24, 21:15",
    });
  });

  it("carries the next bid's dates too, under that bid", () => {
    expect(brief(bidTimeline(pack({ bidCalendar: printed })), "NOV26")).toMatchObject({
      "bid-close": "Tue, Oct 6, 12:00",
      "conflict-open": "Tue, Oct 6, 17:00",
      "open-time": "Thu, Oct 22, 19:15",
    });
  });

  it("leaves out what isn't part of the bid: vacation passes, ITU training, expense reports", () => {
    const labels = bidTimeline(pack({ bidCalendar: printed })).map((e) => e.label).join(" ");
    expect(labels).not.toMatch(/ITU|Vacation|Expense|Bid Month/i);
  });

  it("uses LBT at the pack's own base: open time in Anchorage is Anchorage time", () => {
    const at = bidTimeline(pack({ bidCalendar: printed, base: "ANC" })).find((e) => e.kind === "open-time")!.at;
    expect(new Date(at).toLocaleString("en-US", { timeZone: "America/Anchorage", hour: "2-digit", minute: "2-digit", hour12: false })).toBe("19:15");
  });

  it("lets the pilot's own close replace the printed one, and only that", () => {
    const events = bidTimeline(pack({ bidCalendar: printed }), "2026-09-08T20:00:00.000Z");
    const close = events.find((e) => e.bidMonth === "OCT26" && e.kind === "bid-close")!;
    expect(close).toMatchObject({ at: "2026-09-08T20:00:00.000Z", source: "pilot" });
    expect(events.filter((e) => e.bidMonth === "OCT26" && e.kind === "bid-close")).toHaveLength(1);
    expect(events.find((e) => e.kind === "view-add-open")?.source).toBe("pack");
  });
});

describe("counted from the close when nothing is printed", () => {
  it("has nothing to say with no close: never works back from the bid period's start", () => {
    expect(bidTimeline(pack({ month: "JAN27" }))).toEqual([]);
  });

  // The union's chart, new times: CA bid closes Mon 1200 CT, and so on.
  it("CBA 2026, Captain: 25.C.4, 25.E.2 fixed, the rest from the chart and marked estimated", () => {
    const events = bidTimeline(pack({ month: "JAN27" }), "2026-12-07T18:00:00.000Z");
    expect(brief(events, "JAN27")).toEqual({
      "bid-close": "Mon, Dec 7, 12:00",
      "conflict-open": "Mon, Dec 7, 17:00", // 25.E.2: 5 hours following the close
      "conflict-close": "Thu, Dec 10, 07:00",
      "view-add-open": "Sat, Dec 12, 07:00",
      "view-add-close": "Mon, Dec 14, 07:00",
      "sww-open": "Tue, Dec 15, 17:00",
      "sww-close": "Sun, Dec 20, 12:00",
      "secondary-lines": "Tue, Dec 22, 17:00",
      "open-time": "Thu, Dec 24, 20:00",
    });
    expect(events.find((e) => e.kind === "bid-close")?.source).toBe("pilot");
    expect(events.find((e) => e.kind === "conflict-open")?.source).toBe("contract");
    for (const kind of ["conflict-close", "view-add-open", "view-add-close", "sww-open", "sww-close", "secondary-lines", "open-time"]) {
      const e = events.find((x) => x.kind === kind)!;
      expect(e.source).toBe("estimated");
      expect(e.basis).toMatch(/^Estimated/);
    }
  });

  it("CBA 2026, First Officer: 25.C.4 0700 CT on the 2nd day; 25.E.2 opens 5 hours later", () => {
    const events = bidTimeline(pack({ month: "JAN27", seat: "FO" }), "2026-12-09T13:00:00.000Z");
    expect(brief(events, "JAN27")).toMatchObject({
      "bid-close": "Wed, Dec 9, 07:00",
      "conflict-open": "Wed, Dec 9, 12:00",
      "conflict-close": "Fri, Dec 11, 12:00",
      "view-add-open": "Sat, Dec 12, 07:00",
      "open-time": "Thu, Dec 24, 22:00",
    });
  });

  it("CBA 2026 25.E.6: the chart's SWW days make its 115-hour minimum exactly", () => {
    const events = bidTimeline(pack({ month: "JAN27" }), "2026-12-07T18:00:00.000Z");
    const at = (k: string) => new Date(events.find((e) => e.kind === k)!.at).getTime();
    expect((at("sww-close") - at("sww-open")) / 3_600_000).toBe(115);
  });

  it("prefers the pack's own open-time release time to the chart's", () => {
    const events = bidTimeline(pack({ month: "JAN27", info: { openTimeRelease: "19:30" } }), "2026-12-07T18:00:00.000Z");
    expect(central(events.find((e) => e.kind === "open-time")!.at)).toBe("Thu, Dec 24, 19:30");
  });

  // CBA 2015 25.E.2: "beginning at 1700 CT on the date the bid closes". Checked against the dates the real pack prints.
  it("CBA 2015: counting from the close lands on the dates the OCT26 cover prints, for both seats", () => {
    const stripped = (e: TimelineEvent) => [e.kind, e.at];
    for (const seat of ["CAP", "FO"] as const) {
      const real = bidTimeline(pack({ bidCalendar: printed, seat, info: { openTimeRelease: seat === "CAP" ? "19:15" : "21:15" } })).filter((e) => e.bidMonth === "OCT26");
      const close = real.find((e) => e.kind === "bid-close")!.at;
      const counted = bidTimeline(pack({ seat, info: { openTimeRelease: seat === "CAP" ? "19:15" : "21:15" } }), close);
      expect(counted.map(stripped)).toEqual(real.map(stripped));
    }
  });

  it("counts from the contract's close when the pack prints only the bid opening (25.C.4)", () => {
    const events = bidTimeline(pack({ month: "DEC26", bidCalendar: [{ date: "2026-11-05", text: "DEC26 Bid Opens 1700 CT", time: "17:00", zone: "CT" }] }));
    expect(events[0]).toMatchObject({ kind: "bid-close", source: "contract" });
  });
});
