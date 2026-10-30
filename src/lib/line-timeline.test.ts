import { describe, expect, it } from "vitest";
import { buildLineTimeline } from "@/lib/line-timeline";
import { pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import { anchorTripToItsDate } from "@/lib/trip-anchor";
import type { Line, Trip } from "@/types/bidpack";

// Rows verbatim from the October 2026 FedEx bid packs.
const start = "2026-09-28";
const tripFrom = (rows: string[], startDayIndex: number, base: string): Trip => {
  const [pairing] = parsePairingColumn(rows, 1, []);
  return anchorTripToItsDate({ bidPeriodStart: start, base }, { ...pairingToTrip(pairing, "OCT26"), startDayIndex });
};
const pacific = tripFrom(
  [
    "38 SA REPORT AT 1745 (0945) STANDARD CREW",
    "EFFECTIVE OCTOBER 3 ONLY",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "03SA 5132 83 ANC 1845(1045) ICN 0415(1315) 09:30 DH/BH 09:30 09:30 11:00 ICN 27:40",
    "05MO 6800 83 ICN 0925(1825) KIX 1120(2020) 01:55 DH",
    "05MO 5162 83 KIX 1255(2155) XMN 1645(0045) 03:50 05:45 05:45 08:50 XMN 48:45",
    "#07WE 5161 83 XMN 1900(0300) ICN 2137(0637) 02:37 02:37 03:12 04:07 ICN 24:33",
    "#08TH 5163 83 ICN 2340(0840) ANC 0741(2341) 08:01 BH/DH 08:01 08:01 09:31",
    "LDGS: 5 BLOCK HRS: 25:53 CREDIT HRS: 35:51 T TAFB: 134:26",
  ],
  5,
  "ANC"
);
const line: Line = { id: "l", lineNumber: "1009", trips: [pacific], daysOff: 22, totalCreditHours: 35.85, totalTafbHours: 134.43, totalLandings: 5, totalDepartures: 5, gridOffDays: [0, 1, 2, 3, 4, 11, 12, 13] };
const pack = { bidPeriodStart: start, bidPeriodDays: 14, base: "ANC" };

describe("buildLineTimeline", () => {
  const t = buildLineTimeline(line, pack, 21);

  it("puts the trip where its report falls, on the base's clock, with its number and credit", () => {
    expect(t.trips).toHaveLength(1);
    expect(t.trips[0]).toMatchObject({ number: "38", creditHours: pacific.creditHours, days: pacific.days });
    // Reports 09:45 on Sat Oct 3 at Anchorage — day 5 of the period.
    expect(t.trips[0].start).toBe(5 * 1440 + 9 * 60 + 45);
  });

  it("draws every leg to scale and every layover between duties, with its city", () => {
    expect(t.legs.map((l) => l.flight)).toEqual(["5132", "6800", "5162", "5161", "5163"]);
    expect(t.legs[0].end - t.legs[0].start).toBe(9 * 60 + 30);
    expect(t.stays.map((s) => s.city)).toEqual(["ICN", "XMN", "ICN"]);
    for (const [i, s] of t.stays.entries()) {
      expect(s.start).toBeGreaterThanOrEqual(t.duties[i].end - 1);
      expect(s.end).toBeLessThanOrEqual(t.duties[i + 1].start + 1);
    }
  });

  it("counts the runs of days off from the pack's own off days", () => {
    expect(t.offRuns).toEqual([
      { day: 0, length: 5 },
      { day: 11, length: 3 },
    ]);
  });

  it("draws nothing it can't place without the pack's real dates", () => {
    expect(buildLineTimeline(line, { ...pack, bidPeriodStart: null }, 21).legs).toEqual([]);
  });
});
