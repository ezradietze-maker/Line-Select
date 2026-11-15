import { describe, expect, it } from "vitest";
import { formatHoursValue } from "@/lib/interview-config";
import { guaranteeShortfall, linePay, minBidPeriodGuarantee, parseCreditHours, payClaimText, tripPay, tripRig } from "@/lib/pay/trip-guarantee";
import type { Line, Trip } from "@/types/bidpack";

const trip = (creditHours: number, tafbHours: number): Trip => ({ creditHours, tafbHours, schedule: [] } as unknown as Trip);
/** A run of the same day trip on consecutive days, as the parser keeps it: one trip, its days' credit and TAFB summed. */
const run = (days: number, dayCredit: number, dayTafb: number, startDayIndex: number): Trip =>
  ({
    id: "p-30",
    pairingNumber: "30",
    days,
    creditHours: days * dayCredit,
    tafbHours: days * dayTafb,
    startDayIndex,
    layoverDetails: [],
    zuluAnchor: "",
    runStarts: Array.from({ length: days }, (_, i) => i),
    schedule: Array.from({ length: days }, (_, i) => ({ reportTimeLocal: "0700", startMinutes: i * 1440, legs: [], layover: null })),
  }) as unknown as Trip;
const line = (trips: Trip[], carryOverCreditHours?: number): Line => ({ trips, carryOverCreditHours } as Line);

describe("trip rig (CBA 2026 4.F.2.a)", () => {
  it("is 1 CH per 3.75 hours of TAFB", () => {
    expect(tripRig(3.75)).toBe(1);
    expect(tripRig(75)).toBe(20);
    expect(tripRig(0)).toBe(0);
  });
  it("is rounded to the nearest minute, as 4.F.2.a says", () => {
    // 41:05 away is 657.33 minutes of rig: 10:57, not the 10:58 that hundredths of an hour read.
    expect(formatHoursValue(tripRig(41 + 5 / 60))).toBe("10:57");
    expect(tripRig(41 + 5 / 60) * 60).toBeCloseTo(657, 9);
  });
  it("is worked from the TAFB the pack prints, to the minute, not the hundredths it's kept in", () => {
    // 44:58 away is kept as 44.97 hours. 44:58 is 719.47 minutes of rig, 11:59; 44.97 read 719.52, 12:00, a minute over
    // the 11:59 the trip is credited, which rig can never be (4.F.1.a).
    expect(formatHoursValue(tripRig(44.97))).toBe("11:59");
    expect(formatHoursValue(tripRig(78.97))).toBe("21:03"); // 78:58
    expect(tripPay(trip(11 + 59 / 60, 44.97)).rigCH).toBeLessThanOrEqual(11 + 59 / 60);
  });
});

describe("minimum bid period guarantee (CBA 2026 4.A.1)", () => {
  it("is 68 / 85 / 102 CH by bid-period length", () => {
    expect(minBidPeriodGuarantee(28)?.ch).toBe(68);
    expect(minBidPeriodGuarantee(35)?.ch).toBe(85);
    expect(minBidPeriodGuarantee(42)?.ch).toBe(102);
  });
});

describe("tripPay", () => {
  it("reports the guarantee, rig, and credit per day away", () => {
    const p = tripPay(trip(18, 48));
    expect(p.guaranteeCH).toBe(18);
    expect(p.rigCH).toBe(tripRig(48)); // 12.8
    expect(p.creditPerDayAway).toBe(9); // 18 CH over 2 days away
  });
});

describe("linePay (CBA 2026 4.B / 4.A.1)", () => {
  it("sums the trip guarantees when they clear the floor", () => {
    const lp = linePay(line([trip(40, 100), trip(40, 100)]), { bidPeriodDays: 28 });
    expect(lp.tripGuaranteeTotal).toBe(80);
    expect(lp.blg).toBe(80);
    expect(lp.flooredUp).toBe(false);
  });
  it("4.B: leaves out the share of a trip over the period's end that the line carries into the next one", () => {
    const lp = linePay(line([trip(40, 100), trip(40, 100)], 15), { bidPeriodDays: 28 });
    expect(lp.carryOverCH).toBe(15);
    expect(lp.tripGuaranteeTotal).toBe(65);
    expect(lp.blg).toBe(68);
    expect(lp.flooredUp).toBe(true);
  });
  it("adds the trips to the minute, as the pack prints them", () => {
    // Four 18:56 trips are 75:44. Each read as 18.93 hours, they added to 75:43.
    const g = 18 + 56 / 60;
    const lp = linePay(line([trip(g, 40), trip(g, 40), trip(g, 40), trip(g, 40)]), { bidPeriodDays: 28 });
    expect(formatHoursValue(lp.tripGuaranteeTotal)).toBe("75:44");
    expect(formatHoursValue(lp.blg)).toBe("75:44");
  });
  it("takes a run of the same day trip as its days: each is its own trip, with its own guarantee and date", () => {
    // Trip 30 three days running, 4:16 and 7:30 away a day. Kept whole, it read one 12:48 trip on the first day, and a
    // pilot paid 4:16 for the second day was told 8:32 was owed.
    const lp = linePay(line([run(3, 4 + 16 / 60, 7.5, 21)]), { bidPeriodDays: 28 });
    expect(lp.trips.map((t) => [t.trip.startDayIndex, formatHoursValue(t.guaranteeCH), formatHoursValue(t.rigCH)])).toEqual([
      [21, "4:16", "2:00"],
      [22, "4:16", "2:00"],
      [23, "4:16", "2:00"],
    ]);
    expect(formatHoursValue(lp.tripGuaranteeTotal)).toBe("12:48");
  });
  it("floors a thin line up to the minimum bid period guarantee", () => {
    const lp = linePay(line([trip(20, 60)]), { bidPeriodDays: 28 });
    expect(lp.tripGuaranteeTotal).toBe(20);
    expect(lp.blg).toBe(68);
    expect(lp.flooredUp).toBe(true);
    expect(lp.floor?.section).toBe("4.A.1.a");
  });
});

describe("guaranteeShortfall (CBA 2026 4.F.1)", () => {
  it("is the amount paid under the guarantee, never negative", () => {
    expect(guaranteeShortfall(18, 14)).toBe(4);
    expect(guaranteeShortfall(18, 20)).toBe(0);
  });
  it("owes the minutes an 18:56 trip was paid short, never a fraction of one that read 0.0 owed", () => {
    const g = 18 + 56 / 60;
    expect(guaranteeShortfall(g, 18.9) * 60).toBe(2);
    expect(formatHoursValue(guaranteeShortfall(g, 18.9))).toBe("0:02");
    // Under half a minute short rounds to paid in full.
    expect(guaranteeShortfall(18.93, 18.925)).toBe(0);
  });
});

describe("parseCreditHours", () => {
  it("reads credit as the pack and a pay statement print it, and as hours", () => {
    expect(parseCreditHours("14:30")).toBe(14.5);
    expect(parseCreditHours(" 7:05 ")).toBeCloseTo(7 + 5 / 60, 10);
    expect(parseCreditHours("14.5")).toBe(14.5);
    expect(parseCreditHours("14")).toBe(14);
    expect(parseCreditHours(".5")).toBe(0.5);
  });
  it("refuses what isn't a credit figure, rather than reading 14:30 as 1430", () => {
    for (const s of ["", "1430:00", "14:75", "14:3", "abc", "-2", "1e3"]) expect(parseCreditHours(s)).toBeNull();
  });
});

describe("payClaimText", () => {
  const pack = { base: "MEM", aircraft: "B777", seat: "FO", month: "OCT26" } as const;
  it("names the trip by number and date, and the amounts to the minute", () => {
    const text = payClaimText({ pack, trip: { pairingNumber: "2192" }, date: "Oct 15", guaranteeCH: 18 + 56 / 60, paidCH: 14.5 });
    expect(text).toContain("Pay claim — trip 2192 on Oct 15, MEM B777 FO, bid period OCT26.");
    expect(text).toContain("was 18:56 CH. I was credited 14:30 CH.");
    expect(text).toContain("claiming the 4:26 CH difference.");
  });
  it("leaves the date out when the pack doesn't date the trip", () => {
    expect(payClaimText({ pack, trip: { pairingNumber: "13" }, date: null, guaranteeCH: 10, paidCH: 9 })).toContain("Pay claim — trip 13, MEM");
  });
});
