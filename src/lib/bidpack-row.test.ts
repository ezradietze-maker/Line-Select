import { describe, expect, it } from "vitest";
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

  it("prints each day as B777 ANC line 1012's grid does: the layover city after the last leg, the stay's whole days, no city before a flight", () => {
    // Out of Anchorage on the 3rd to a Seoul layover.
    expect(texts(5)).toEqual(["5132", "ICN"]);
    // The 4th spent there.
    expect(texts(6)).toEqual(["ICN"]);
    // The 5th: to Osaka at 1825 and on to Xiamen at 2155. The pack has no row left that evening for XMN, so it heads the 6th.
    expect(texts(7)).toEqual(["6800", "5162"]);
    expect(texts(8)).toEqual(["XMN"]);
    // The 7th still there; out at 0300 on the 8th to Seoul, and home from Seoul on the 9th.
    expect(texts(9)).toEqual(["XMN"]);
    expect(texts(10)).toEqual(["5161", "ICN"]);
    expect(texts(11)).toEqual(["5163"]);
    expect(row[10].tokens.map((t) => t.kind)).toEqual(["flight", "layover"]);
  });

  it("prints a flight leaving just after midnight on the day before, as the line grid does (B777 ANC line 2025, trip 8)", () => {
    const trip8 = tripFrom(
      [
        "8 SU REPORT AT 0742 (*2342) STANDARD CREW",
        "EFFECTIVE OCTOBER 4 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "04SU 6031 83 ANC 0842(0042) CAN 2007(0407) 11:25 BH/DH 11:25 11:25 12:55 CAN 21:43",
        "Hotel: WHITE SWAN (CAN), +86-20-8188-6968",
        "#05MO 5419 83 CAN 1920(0320) SIN 2328(0728) 04:08 BSI 04:08 04:08 05:38 SIN 31:57",
        "Hotel: FAIRMONT SINGAPORE HOTEL (SIN), +65-6431-5548",
        "07WE 5601 83 SIN 0855(1655) ANC 2126(1326) 12:31 DH/BH 12:31 12:31 14:01",
        "LDGS: 3 BLOCK HRS: 28:04 CREDIT HRS: 28:04 TAFB: 86:14",
      ],
      5,
      "ANC"
    );
    const days = buildPackRow(lineOf([trip8]), start, 28, 35).map((d) => d.tokens.map((t) => t.text));
    // Reports 2342 on Sat Oct 3 for 6031 at 0042 on the 4th: the grid prints 6031 on the 3rd, under the trip's number.
    expect(days.slice(5, 10)).toEqual([["6031"], ["CAN"], ["CAN"], ["5419", "SIN"], ["5601"]]);
  });

  it("runs a day's fourth row over into the next day, as B767 MEM line 1029's grid does with trip 76", () => {
    const trip76 = tripFrom(
      [
        "76 WE REPORT AT 1552 (1052) STANDARD CREW",
        "EFFECTIVE SEPTEMBER 30 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "30WE DL0082 JET MEM 1652(1152) ATL 1810(1410) 01:18 S",
        "30WE DL0082 JET ATL 1940(1540) CDG 0410(0610) 08:30 S 00:00 09:48 12:48 CDG 19:52",
        "Hotel: A/P MARRIOTT 01133134385353 (CDG)",
        "02FR 5084 72 CDG 0132(0332) CGN 0244(0444) 01:12",
        "02FR 5084 72 CGN 0344(0544) BLL 0455(0655) 01:11 02:23 03:12 04:53 BLL 85:07",
        "Hotel: 4PTS SHERATON VEJLE (BLL), +45-301-25-774",
        "05MO 5187 72 BLL 1932(2132) HAJ 2029(2229) 00:57",
        "05MO 5187 72 HAJ 2129(2329) CDG 2300(0100) 01:31 MS 02:28 03:12 04:58 CDG 18:05",
        "Hotel: A/P MARRIOTT 01133134385353 (CDG)",
        "06TU 5041 72 CDG 1835(2035) MXP 2008(2208) 01:33 01:33 03:12 03:03 MXP 17:22",
        "Hotel: HILTON G'INN MXP AP (MXP), 0039 0331 1640050",
        "07WE 5233 72 MXP 1500(1700) CDG 1630(1830) 01:30 DSI",
        "07WE 5041 72 CDG 1835(2035) MXP 2008(2208) 01:33 03:03 06:24 06:38 MXP 17:22",
        "Hotel: HILTON G'INN MXP AP (MXP), 0039 0331 1640050",
        "08TH 5233 72 MXP 1500(1700) CDG 1630(1830) 01:30 DH",
        "08TH 5034 72 CDG 1742(1942) FRA 1900(2100) 01:18",
        "08TH 0036 72 FRA 2035(2235) CDG 2153(2353) 01:18 04:06 06:24 08:23 CDG 12:17",
        "Hotel: A/P MARRIOTT 01133134385353 (CDG)",
        "09FR AA0151 JET CDG 1240(1440) ORD 2150(1650) 09:10 S 00:00 09:10 11:40 ORD 18:20",
        "Hotel: THE WESTIN O'HARE (ORD), +1-847-698-6000",
        "10SA UA5414 JET ORD 1740(1240) MEM 1944(1444) 02:04 S 00:00 03:12 03:34",
        "LDGS: 10 BLOCK HRS: 13:33 CREDIT HRS: 65:10 T TAFB: 244:22",
      ],
      2,
      "MEM"
    );
    const days = buildPackRow(lineOf([trip76]), start, 28, 35).map((d) => d.tokens.map((t) => t.text));
    // The line grid, Sep 30 - Oct 10, its four rows a day read top to bottom.
    expect(days.slice(2, 13)).toEqual([
      ["D/H", "D/H", "CDG"],
      ["CDG"],
      ["5084", "5084", "BLL"],
      ["BLL"],
      ["BLL"],
      ["5187"],
      ["5187", "CDG", "5041"],
      ["MXP", "5233", "5041"],
      ["MXP", "5233", "5034"],
      // 0036 leaves Frankfurt at 2235 on the 8th, but the 8th's rows are full: the pack prints it on the 9th.
      ["0036", "CDG", "D/H", "ORD"],
      ["D/H"],
    ]);
  });

  it("prints airport standby as the line page does, ASBY, not hotel standby's HSBY", () => {
    // B767 MEM pairing 171: a couple of hours on call at GDL right after landing (STARPT), "ASBY" on the line page.
    const gdl = tripFrom(
      [
        "171 MO TU WE TH REPORT AT 0831 (0331) STANDARD CREW",
        "EFFECTIVE SEPTEMBER 28 - OCTOBER 22",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "1 0065 76 MEM 0931(0431) GDL 1246(0646) 03:15 BMI",
        "1 STARPT GDL 1446(0846) GDL 1635(1035) 01:49 S 03:15 05:23 08:04 GDL 31:50",
        "Hotel: F. AMERICANA 011523338253434 (GDL), +52-33-3818-1400",
        "*3 0066 76 GDL 0125(1925) MEM 0438(2338) 03:13 03:13 03:13 04:43",
        "LDGS: 2 BLOCK HRS: 06:28 CREDIT HRS: 11:54 T TAFB: 44:37",
      ],
      0,
      "MEM"
    );
    const words = buildPackRow(lineOf([gdl]), start, 28, 35).flatMap((d) => d.tokens.map((t) => t.text));
    expect(words).toContain("ASBY");
    expect(words).not.toContain("HSBY");
  });

  it("never prints more than a day's cell holds", () => {
    expect(Math.max(...row.map((d) => d.tokens.length))).toBeLessThanOrEqual(PACK_TOKENS_PER_DAY);
  });
});
