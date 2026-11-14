import { describe, expect, it } from "vitest";
import { canHold, carryInReachDays, isTradeable, touchesVacation, tradeDeadlineHours, tripInstanceKey } from "@/lib/trades/legality";
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

  it("stops at 2 hours before show, and at 1 hour once real-time trading is in, August 2027 (25.L.9.a.ii)", () => {
    expect(tradeDeadlineHours({ month: "OCT26" })).toBe(2);
    expect(tradeDeadlineHours({ month: "NOV26" })).toBe(2);
    // Phase 2 keeps 2 hours: the clause gives 1 hour only "Upon implementation of 25.L.1.a." (Phase 3).
    expect(tradeDeadlineHours({ month: "DEC26" })).toBe(2);
    expect(tradeDeadlineHours({ month: "JUL27" })).toBe(2);
    expect(tradeDeadlineHours({ month: "AUG27" })).toBe(1);
    // Day 3 is Oct 1, reporting 10:00 in Memphis, 15:00Z.
    const show = Date.UTC(2026, 9, 1, 15);
    const t = trip("a", 3);
    expect(isTradeable(pack, t, none, show - 2.5 * 3_600_000)).toBe(true);
    expect(isTradeable(pack, t, none, show - 1.5 * 3_600_000)).toBe(false);
    const december = { ...pack, month: "DEC26", bidPeriodStart: "2026-09-28" };
    expect(isTradeable(december, t, none, show - 1.5 * 3_600_000)).toBe(false);
    const august = { ...pack, month: "AUG27", bidPeriodStart: "2026-09-28" };
    expect(isTradeable(august, t, none, show - 1.5 * 3_600_000)).toBe(true);
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

describe("the days held back while a carry-in isn't known", () => {
  it("counts them on the base's clock, not from midnight GMT", () => {
    // Nothing here carries out past 2 days: trips starting Sep 28 or 29 are held back, two days, here and in Anchorage.
    expect(carryInReachDays({ ...pack, lines: [] } as BidPack)).toBe(2);
    expect(carryInReachDays({ ...pack, base: "ANC", lines: [] } as BidPack)).toBe(2);
    // A line running from day 25 at 10:00 for 150 hours lands back 3 days and 16 hours past the end: 4 days.
    const long = { ...trip("long", 25, 150), days: 7 } as Trip;
    expect(carryInReachDays({ ...pack, lines: [{ lineNumber: "1", trips: [long] }] } as unknown as BidPack)).toBe(4);
  });
});

describe("held to View/Add's and Open time's own checks", () => {
  // A day trip with one 2-hour leg, as View/Add's own tests build them: 08:00 show, `tafb` hours to release.
  const dayTrip = (id: string, startDayIndex: number, tafb = 10, report = "0800"): Trip =>
    ({
      id,
      pairingNumber: id,
      startDayIndex,
      tafbHours: tafb,
      days: 1,
      schedule: [{ reportTimeLocal: report, startMinutes: 0, legs: [{ flightNumber: "1", isDeadhead: false, depAirport: "MEM", arrAirport: "IND", blockHours: 2, startMinutes: 60, endMinutes: tafb * 60 }], layover: null }],
    }) as unknown as Trip;
  const december = { ...pack, month: "DEC26", bidPeriodStart: "2026-11-30", aircraft: "B767", seat: "CAP", lines: [] } as unknown as BidPack;

  it("refuses a swap that runs past 144 hours with no 24 hours off, though every gap passes 12 hours (CBA 2026 12.C.1.b)", () => {
    const run = [0, 1, 2, 3, 4, 5].map((d) => dayTrip(`k${d}`, d));
    expect(canHold(december, run, dayTrip("x", 6), [])).toBe(false);
    expect(canHold(december, run.slice(0, 5), dayTrip("x", 5), [])).toBe(true);
  });

  it("takes a domestic rest of 9:30, though under 12 hours (CBA 2026 12.C.6.a, December 2026 on)", () => {
    // 08:00 to 18:00, then a show at 04:00: 10 hours off.
    expect(canHold(december, [dayTrip("k", 5)], dayTrip("x", 6, 6, "0400"), [])).toBe(true);
    // 9 hours off is under the rest, and 22 hours as one duty is past 12.C.4.e.
    expect(canHold(december, [dayTrip("k", 5)], dayTrip("x", 6, 6, "0300"), [])).toBe(false);
  });

  it("takes a hub turn as one duty within 12.C.4.e, which names a trip trade", () => {
    // 08:00 to 14:00, then out again at 17:00 and released at 19:00: 11 hours as one duty, the most 13:30.
    expect(canHold(december, [dayTrip("k", 5, 6)], dayTrip("x", 5, 3, "1600"), [])).toBe(true);
    // Released at 23:00: 15 hours, past it.
    expect(canHold(december, [dayTrip("k", 5, 6)], dayTrip("x", 5, 7, "1600"), [])).toBe(false);
  });

  it("fits around what's carried in from last month", () => {
    // Day 0 is Nov 30; a trip carried in from November releases that evening.
    const carried = { kind: "trip" as const, id: "c", label: "carry-in trip", report: "2026-11-28T14:00:00Z", release: "2026-11-30T23:00:00Z", international: false };
    expect(canHold(december, [], dayTrip("x", 0), [])).toBe(true);
    expect(canHold(december, [], dayTrip("x", 0), [], [carried])).toBe(false);
    expect(canHold(december, [], dayTrip("x", 3), [], [carried])).toBe(true);
  });

  it("refuses a trip under the rest after a carry-in typed by hand, when as one duty it's past 12.C.4.e", () => {
    // Released Nov 30 17:00 in Memphis; its duties weren't given. A show at 00:00 is 7 hours off, and as one duty it
    // runs from before 17:00 to 10:00: over 13:30 whatever its show.
    const carried = { kind: "trip" as const, id: "c", label: "carry-in trip", report: "2026-11-28T14:00:00Z", release: "2026-11-30T23:00:00Z", international: false };
    expect(canHold(december, [], dayTrip("x", 1, 10, "0000"), [], [carried])).toBe(false);
    // Out at 20:00 for 2 hours: one duty of 5 hours or more, which its last duty's show decides. Not ruled out.
    expect(canHold(december, [], dayTrip("x", 0, 2, "2000"), [], [carried])).toBe(true);
    // A legal rest after it: fine.
    expect(canHold(december, [], dayTrip("x", 1, 10, "0300"), [], [carried])).toBe(true);
  });
});
