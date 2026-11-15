import { describe, expect, it } from "vitest";
import { formatHoursValue } from "@/lib/interview-config";
import { guaranteeShortfall, linePay, minBidPeriodGuarantee, parseCreditHours, payClaimText, tripPay, tripRig } from "@/lib/pay/trip-guarantee";
import type { Line, Trip } from "@/types/bidpack";

const trip = (creditHours: number, tafbHours: number): Trip => ({ creditHours, tafbHours } as Trip);
const line = (trips: Trip[], carryOverCreditHours?: number): Line => ({ trips, carryOverCreditHours } as Line);

describe("trip rig (CBA 2026 4.F.2.a)", () => {
  it("is 1 CH per 3.75 hours of TAFB", () => {
    expect(tripRig(3.75)).toBe(1);
    expect(tripRig(75)).toBe(20);
    expect(tripRig(0)).toBe(0);
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
