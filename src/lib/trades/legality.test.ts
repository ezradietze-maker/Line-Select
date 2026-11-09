import { describe, expect, it } from "vitest";
import { canHold, isTradeable, touchesVacation, tradeDeadlineHours, tripInstanceKey } from "@/lib/trades/legality";
import type { BidPack, Trip } from "@/types/bidpack";

const pack = { id: "uploaded-mem-md11-fo-oct26", base: "MEM", month: "OCT26", bidPeriodStart: "2026-09-28", bidPeriodDays: 28 } as BidPack;

function trip(id: string, startDayIndex: number | null, tafbHours = 48, report = "1000"): Trip {
  return { id, startDayIndex, tafbHours, days: Math.ceil(tafbHours / 24), schedule: [{ reportTimeLocal: report, startMinutes: 0, legs: [], layover: null }] } as unknown as Trip;
}

const beforeMonth = Date.UTC(2026, 8, 20);
const none = new Set<string>();

describe("what can be traded", () => {
  it("allows a dated trip well before its show", () => {
    expect(isTradeable(pack, trip("a", 3), none, beforeMonth)).toBe(true);
  });

  it("refuses a trip the pilot marked as locked (25.L.1.h, 25.L.1.c)", () => {
    const t = trip("a", 3);
    expect(isTradeable(pack, t, new Set([tripInstanceKey(t)]), beforeMonth)).toBe(false);
  });

  it("refuses a trip with no date, or that runs past the bid month's end", () => {
    expect(isTradeable(pack, trip("a", null), none, beforeMonth)).toBe(false);
    expect(isTradeable(pack, trip("a", 27, 72), none, beforeMonth)).toBe(false);
  });

  it("stops at 2 hours before show, and at 1 hour from the December 2026 bid period (25.L.9.a.ii)", () => {
    expect(tradeDeadlineHours({ month: "OCT26" })).toBe(2);
    expect(tradeDeadlineHours({ month: "NOV26" })).toBe(2);
    expect(tradeDeadlineHours({ month: "DEC26" })).toBe(1);
    expect(tradeDeadlineHours({ month: "JAN27" })).toBe(1);
    // Day 3 is Oct 1, reporting 10:00 in Memphis, 15:00Z.
    const show = Date.UTC(2026, 9, 1, 15);
    const t = trip("a", 3);
    expect(isTradeable(pack, t, none, show - 2.5 * 3_600_000)).toBe(true);
    expect(isTradeable(pack, t, none, show - 1.5 * 3_600_000)).toBe(false);
    const december = { ...pack, month: "DEC26", bidPeriodStart: "2026-09-28" };
    expect(isTradeable(december, t, none, show - 1.5 * 3_600_000)).toBe(true);
  });
});

describe("what a pilot can hold", () => {
  it("refuses a trip overlapping one they keep, or too close to it (25.L.1.d)", () => {
    const keeping = [trip("k", 10)]; // Oct 8 10:00 to Oct 10 10:00, Memphis
    expect(canHold(pack, keeping, trip("x", 11), [])).toBe(false);
    expect(canHold(pack, keeping, trip("x", 12), [])).toBe(false); // lands, and shows again the same morning
    expect(canHold(pack, keeping, trip("x", 13), [])).toBe(true);
    expect(canHold(pack, keeping, trip("x", 5), [])).toBe(true);
  });

  it("keeps trades out of a pilot's vacation, in either direction (7.A.4)", () => {
    const vacation = [{ from: "2026-10-05T06:00:00Z", to: "2026-10-12T06:00:00Z", days: 7 }];
    expect(touchesVacation(pack, trip("x", 10), vacation)).toBe(true);
    expect(touchesVacation(pack, trip("x", 20), vacation)).toBe(false);
    expect(canHold(pack, [], trip("x", 10), vacation)).toBe(false);
    expect(canHold(pack, [], trip("x", 20), vacation)).toBe(true);
  });
});
