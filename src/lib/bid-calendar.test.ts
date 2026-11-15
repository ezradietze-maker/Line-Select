import { beforeEach, describe, expect, it, vi } from "vitest";
import { contractBidClose, effectiveBidClose, newBidTimesApply, packBidClose, phase2Applies, printedBidClose } from "@/lib/bid-calendar";
import { bidTimeline, timelineRules } from "@/lib/bid-timeline";
import { setBidDeadline } from "@/lib/bid-deadline-storage";
import type { BidCalendarEvent, BidPack } from "@/types/bidpack";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

// As the real October 2026 MEM packs print them.
const OCT26: BidCalendarEvent[] = [
  { date: "2026-09-03", text: "OCT26 Bid Opens 1700 CT", time: "17:00", zone: "CT" },
  { date: "2026-09-08", text: "OCT26 Cap Bid Closes 1200 CT", time: "12:00", zone: "CT" },
  { date: "2026-09-09", text: "OCT26 F/O Bid Closes 1200 CT", time: "12:00", zone: "CT" },
  { date: "2026-10-06", text: "NOV26 Cap Bid Closes 1200 CT", time: "12:00", zone: "CT" },
];

function pack(over: Partial<BidPack>): BidPack {
  return { id: "p", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [], ...over };
}

describe("bid close from the pack", () => {
  it("reads this month's close for the pack's own seat, in Memphis time", () => {
    // 1200 CDT = 1700 UTC.
    expect(printedBidClose(pack({ bidCalendar: OCT26 }))).toBe("2026-09-08T17:00:00.000Z");
    expect(printedBidClose(pack({ bidCalendar: OCT26, seat: "FO" }))).toBe("2026-09-09T17:00:00.000Z");
  });

  it("never takes next month's close for this month", () => {
    expect(printedBidClose(pack({ month: "NOV26", bidCalendar: OCT26.slice(0, 3) }))).toBeNull();
  });

  it("has nothing to say without a calendar", () => {
    expect(packBidClose(pack({}))).toBeNull();
  });
});

describe("the 2026 contract's close rule (25.C.4, Phase 2)", () => {
  it("Phase 2 rules apply from the December 2026 bid period", () => {
    expect(phase2Applies("NOV26")).toBe(false);
    expect(phase2Applies("DEC26")).toBe(true);
    expect(phase2Applies("JAN27")).toBe(true);
  });

  // Round 25: the countdown counted the DEC26 bid on the 2026 close, the timeline beside it on the 2015 one. Phase 2
  // starts the first day of the December 2026 bid period, after the DEC26 bid has closed: JAN27 is the first bid on it.
  it("a bid's own times are new from the JAN27 bid, the first to close inside Phase 2, the same on the countdown and the timeline", () => {
    expect(newBidTimesApply("NOV26")).toBe(false);
    expect(newBidTimesApply("DEC26")).toBe(false);
    expect(newBidTimesApply("JAN27")).toBe(true);
    for (const month of ["OCT26", "NOV26", "DEC26", "JAN27", "FEB27", "AUG27", "DEC27"]) {
      expect(timelineRules(month), month).toBe(newBidTimesApply(month) ? "2026" : "2015");
    }
  });

  it("counts from the pack's printed publication: Captains 1200 CT on the 4th day, F/Os 0700 CT two days later", () => {
    const jan: BidCalendarEvent[] = [{ date: "2026-12-03", text: "JAN27 Bid Opens 1700 CT", time: "17:00", zone: "CT" }];
    // Thu Dec 3 publication → Mon Dec 7 1200 CST (1800 UTC); F/O Wed Dec 9 0700 CST (1300 UTC).
    expect(contractBidClose(pack({ month: "JAN27", bidCalendar: jan }))).toBe("2026-12-07T18:00:00.000Z");
    expect(contractBidClose(pack({ month: "JAN27", bidCalendar: jan, seat: "FO" }))).toBe("2026-12-09T13:00:00.000Z");
    expect(packBidClose(pack({ month: "JAN27", bidCalendar: jan }))?.source).toBe("contract");
  });

  it("isn't used for the DEC26 bid or before it, and always loses to a printed close", () => {
    expect(contractBidClose(pack({ bidCalendar: OCT26 }))).toBeNull();
    const opens: BidCalendarEvent[] = [{ date: "2026-11-05", text: "DEC26 Bid Opens 1700 CT", time: "17:00", zone: "CT" }];
    // It closed on the 2015 times, in November: the 2026 count put an F/O's close a day late and the timeline after it.
    for (const seat of ["CAP", "FO"] as const) {
      const p = pack({ month: "DEC26", bidCalendar: opens, seat });
      expect(packBidClose(p), seat).toBeNull();
      expect(bidTimeline(p), seat).toEqual([]);
    }
    const dec: BidCalendarEvent[] = [...opens, { date: "2026-11-10", text: "DEC26 Cap Bid Closes 1200 CT", time: "12:00", zone: "CT" }];
    expect(packBidClose(pack({ month: "DEC26", bidCalendar: dec }))).toEqual({ iso: "2026-11-10T18:00:00.000Z", source: "pack" });
  });
});

describe("effectiveBidClose", () => {
  beforeEach(() => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: memoryStorage() }));
  });

  it("uses the pilot's own time over the pack's", () => {
    const p = pack({ bidCalendar: OCT26 });
    expect(effectiveBidClose(p)?.source).toBe("pack");
    setBidDeadline("p", "2026-09-08T20:00:00.000Z");
    expect(effectiveBidClose(p)).toEqual({ iso: "2026-09-08T20:00:00.000Z", source: "pilot" });
  });
});
