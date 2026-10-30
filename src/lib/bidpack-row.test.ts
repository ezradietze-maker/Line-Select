import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { buildPackRow, packColumnCount, packColumns, PACK_TOKENS_PER_DAY } from "@/lib/bidpack-row";
import { pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import { anchorTripToItsDate } from "@/lib/trip-anchor";
import type { Line, Trip } from "@/types/bidpack";

// Rows verbatim from the October 2026 FedEx bid packs (hotel lines trimmed where they don't matter).
const start = "2026-09-28";
const tripFrom = (rows: string[], startDayIndex: number, base: string): Trip => {
  const [pairing] = parsePairingColumn(rows, 1, []);
  return anchorTripToItsDate({ bidPeriodStart: start, base }, { ...pairingToTrip(pairing, "OCT26"), startDayIndex });
};
const lineOf = (trips: Trip[]): Line => ({ id: "l", lineNumber: "1009", trips, daysOff: 20, totalCreditHours: 35.85, totalTafbHours: 134.43, totalLandings: 5, totalDepartures: 5 });

// ANC → ICN → KIX → XMN → ICN → ANC, Oct 3–8, home across the date line.
const pacific = tripFrom(
  [
    "38 SA REPORT AT 1745 (0945) STANDARD CREW",
    "EFFECTIVE OCTOBER 3 ONLY",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "03SA 5132 83 ANC 1845(1045) ICN 0415(1315) 09:30 DH/BH 09:30 09:30 11:00 ICN 27:40",
    "Hotel: SHERATON GRAND INCHEON HOTEL (ICN), +82 32 745- 1234",
    "05MO 6800 83 ICN 0925(1825) KIX 1120(2020) 01:55 DH",
    "05MO 5162 83 KIX 1255(2155) XMN 1645(0045) 03:50 05:45 05:45 08:50 XMN 48:45",
    "Hotel: SHERATON XIAMEN HOTEL (XMN)",
    "#07WE 5161 83 XMN 1900(0300) ICN 2137(0637) 02:37 02:37 03:12 04:07 ICN 24:33",
    "Hotel: SHERATON GRAND INCHEON HOTEL (ICN), +82 32 745- 1234",
    "#08TH 5163 83 ICN 2340(0840) ANC 0741(2341) 08:01 BH/DH 08:01 08:01 09:31",
    "LDGS: 5 BLOCK HRS: 25:53 CREDIT HRS: 35:51 T TAFB: 134:26",
  ],
  5,
  "ANC"
);

describe("packColumns", () => {
  it("prints the bid period a column a day, weekday and date, the pack's '|' before each week and weekend", () => {
    const cols = packColumns(start, 28, 35);
    expect(cols).toHaveLength(35);
    expect(cols[0]).toMatchObject({ weekday: "MO", dayOfMonth: "28", weekend: false, groupStart: false, beyond: false });
    expect(cols[5]).toMatchObject({ weekday: "SA", dayOfMonth: "3", weekend: true, groupStart: true });
    expect(cols[7]).toMatchObject({ weekday: "MO", dayOfMonth: "5", groupStart: true });
    // A week past the period, for trips that run on into next month.
    expect(cols[28]).toMatchObject({ dayOfMonth: "26", beyond: true });
  });

  it("numbers the days when the pack's dates aren't known", () => {
    expect(packColumns(null, 28, 3).map((c) => [c.dayOfMonth, c.weekday])).toEqual([["1", null], ["2", null], ["3", null]]);
  });
});

describe("packColumnCount", () => {
  it("is the bid period and a week past it, as the pack prints a 28-day month in 35 columns", () => {
    expect(packColumnCount({ bidPeriodStart: start, bidPeriodDays: 28, base: "ANC", lines: [lineOf([pacific])] })).toBe(35);
  });
});

describe("buildPackRow", () => {
  const row = buildPackRow(lineOf([pacific]), start, 28, 35);
  const texts = (d: number) => row[d].tokens.map((t) => t.text);

  it("puts the trip's number and credit on its first day, and shades only its days", () => {
    expect(row[5].label).toEqual({ number: "38", creditHours: pacific.creditHours });
    expect(row[5].trip).toMatchObject({ start: true });
    expect(row[4].trip).toBeNull();
    expect(row.filter((d) => d.label)).toHaveLength(1);
  });

  it("prints every leg on the local date it leaves, as the pack does", () => {
    for (const leg of pacific.schedule.flatMap((d) => d.legs)) {
      const local = DateTime.fromISO(leg.depTimeZulu, { zone: timezoneForAirport(leg.depAirport)! }).toISODate()!;
      const day = Math.round(DateTime.fromISO(local, { zone: "UTC" }).diff(DateTime.fromISO(start, { zone: "UTC" }), "days").days);
      expect(texts(day)).toContain(leg.flightNumber);
    }
  });

  it("names where the pilot sleeps after each duty, wakes up there the next, and stays the whole day between", () => {
    // Out of Anchorage on the 3rd to a Seoul layover.
    expect(texts(5)).toEqual(["5132", "ICN"]);
    // The 4th spent there.
    expect(texts(6)).toEqual(["ICN"]);
    // The 5th: wake in Seoul, fly to Osaka and on to Xiamen — and lay over there.
    expect(texts(7)).toEqual(["ICN", "6800", "5162", "XMN"]);
    expect(row[7].tokens.map((t) => t.kind)).toEqual(["layover", "flight", "flight", "layover"]);
  });

  it("never prints more than a day's cell holds", () => {
    expect(Math.max(...row.map((d) => d.tokens.length))).toBeLessThanOrEqual(PACK_TOKENS_PER_DAY);
  });
});
