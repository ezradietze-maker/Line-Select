import { describe, expect, it } from "vitest";
import { guaranteeShortfall, linePay, minBidPeriodGuarantee, tripPay, tripRig } from "@/lib/pay/trip-guarantee";
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
});
