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
    // Released at 0011 on the 9th, Anchorage time, before 5163's own 0740 report in Seoul: the pack's "=>" under it.
    expect(texts(11)).toEqual(["5163", "=>"]);
    expect(row[11].tokens.map((t) => t.kind)).toEqual(["flight", "arrival"]);
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

  const daysOf = (trips: Trip[]) => buildPackRow(lineOf(trips), start, 28, 35).map((d) => d.tokens.map((t) => t.text));

  it("prints the pack's '=>' on the day a night deadhead home releases on (B757 MEM line 1001, trip 102)", () => {
    const trip102 = tripFrom(
      [
        "102 SA REPORT AT 1053 (0553) STANDARD CREW",
        "EFFECTIVE OCTOBER 3 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "03SA UA6207 JET MEM 1153(0653) IAH 1350(0850) 01:57 S",
        "03SA UA0253 JET IAH 1515(1015) HNL 2334(1334) 08:19 S 00:00 10:16 13:11 HNL 36:26",
        "05MO 1005 22 HNL 1330(0330) ITO 1426(0426) 00:56",
        "05MO 1006 22 ITO 1620(0620) HNL 1714(0714) 00:54 01:50 03:12 05:14 HNL 19:46",
        "06TU 1001 22 HNL 1430(0430) OGG 1514(0514) 00:44",
        "06TU 1002 22 OGG 1711(0711) HNL 1751(0751) 00:40 01:24 03:12 04:51 HNL 18:09",
        "07WE 1005 22 HNL 1330(0330) ITO 1426(0426) 00:56",
        "07WE 1006 22 ITO 1620(0620) HNL 1714(0714) 00:54 01:50 03:12 05:14 HNL 19:46",
        "08TH 1001 22 HNL 1430(0430) OGG 1514(0514) 00:44",
        "08TH 1002 22 OGG 1711(0711) HNL 1751(0751) 00:40 01:24 03:12 04:51 HNL 18:09",
        "09FR 1005 22 HNL 1330(0330) ITO 1426(0426) 00:56",
        "09FR 1006 22 ITO 1620(0620) HNL 1714(0714) 00:54 01:50 03:12 05:14 HNL 32:00",
        "*11SU AA0006 JET HNL 0344(1744) DFW 1100(0600) 07:16 S",
        "11SU AA1935 JET DFW 1213(0713) MEM 1345(0845) 01:32 S 00:00 08:48 12:31",
        "LDGS: 10 BLOCK HRS: 08:18 CREDIT HRS: 52:06 T TAFB: 195:22",
      ],
      5,
      "MEM"
    );
    const days = daysOf([trip102]);
    // Both deadheads leave Honolulu on the 10th; home to Memphis at 0845 on the 11th, nothing else printed that day.
    expect(days.slice(12, 15)).toEqual([["D/H", "D/H"], ["=>"], []]);
  });

  it("leaves the '=>' off a release before 0130 on the next day (A300 MEM line 1013, trip 71)", () => {
    const trip71 = tripFrom(
      [
        "71 SU REPORT AT 2253 (1753) STANDARD CREW",
        "EFFECTIVE OCTOBER 25 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "25SU AA4732 JET MEM 2353(1853) DCA 0215(2215) 02:22 S",
        "*26MO GT9999 CAB DCA 0245(2245) IAD 0345(2345) 01:00 S 00:00 03:15 04:52 IAD 21:55",
        "*27TU 2204 55 IAD 0240(2240) MEM 0504(0004) 02:24 02:24 03:12 03:54",
        "LDGS: 1 BLOCK HRS: 02:24 CREDIT HRS: 08:11 T TAFB: 30:41",
      ],
      27,
      "MEM"
    );
    // Released 0034 on the 27th: the pack counts it the 26th, and prints nothing on the 27th.
    expect(daysOf([trip71]).slice(27, 30)).toEqual([["D/H", "D/H"], ["IAD", "2204"], []]);
  });

  // B777 ANC CAP line 1053's last trip: Anchorage, Guangzhou, Seoul, and home across the date line.
  const trip20 = tripFrom(
    [
      "20 SA REPORT AT 0550 (*2150) STANDARD CREW",
      "EFFECTIVE OCTOBER 24 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "*24SA 6031 83 ANC 0650(2250) CAN 1804(0204) 11:14 DH/BH 11:14 11:14 12:44 CAN 23:56",
      "#25SU 5926 83 CAN 1930(0330) ICN 2248(0748) 03:18 03:18 03:18 04:48 ICN 23:10",
      "#26MO 6006 83 ICN 2328(0828) ANC 0729(2329) 08:01 BH/DH 08:01 08:01 09:31",
      "LDGS: 3 BLOCK HRS: 22:33 CREDIT HRS: 22:33 TAFB: 74:09",
    ],
    25,
    "ANC"
  );

  it("prints the '=>' on the day before the last flight when the date line releases the trip then (B777 ANC line 1053)", () => {
    // 6006 leaves Seoul at 0828 on the 27th and is home 2329 on the 26th, released 2359: "=>" ends the 26th.
    expect(daysOf([trip20]).slice(25, 30)).toEqual([["6031"], ["CAN"], ["CAN"], ["5926", "ICN", "=>"], ["6006"]]);
  });

  it("prints no '=>' when the date line's release falls in the row just before the last flight (B777 ANC line 1016, trip 141)", () => {
    const trip141 = tripFrom(
      [
        "141 FR REPORT AT 1740 (0940) STANDARD CREW",
        "EFFECTIVE OCTOBER 23 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "23FR 0169 83 ANC 1840(1040) SIN 0814(1614) 13:34 DH/BH 13:34 13:34 15:04 SIN 28:16",
        "25SU 6081 84 SIN 1400(2200) CAN 1807(0207) 04:07 DSI 04:07 04:07 05:37 CAN 25:43",
        "#26MO 6172 83 CAN 2120(0520) ANC 0708(2308) 09:48 BH/DH 09:48 09:48 11:18",
        "LDGS: 3 BLOCK HRS: 27:29 CREDIT HRS: 27:29 TAFB: 85:58",
      ],
      25,
      "ANC"
    );
    expect(daysOf([trip141]).slice(25, 31)).toEqual([["0169", "SIN"], ["SIN"], ["6081"], ["CAN"], ["6172"], []]);
  });

  it("prints neither the '=>' nor the next trip's first flight when they want the same row (B777 ANC line 1019)", () => {
    const rows = (seq: string, head: string, effective: string, legs: string[], totals: string) => [
      `${seq} ${head}`,
      effective,
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      ...legs,
      totals,
    ];
    const trip132 = tripFrom(
      rows("132", "WE REPORT AT 2309 (1509) STANDARD CREW", "EFFECTIVE SEPTEMBER 30 ONLY", [
        "*30WE AS0233 JET ANC 0109(1709) SEA 0443(2143) 03:34 S 00:00 03:34 06:04 SEA 13:22",
        "30WE AS0119 JET SEA 2035(1335) ICN 0830(1730) 11:55 S 00:00 11:55 14:25 ICN 37:35",
        "#02FR 5161 83 ICN 2335(0835) ANC 0736(2336) 08:01 BH/DH 08:01 08:01 09:31",
      ], "LDGS: 1 BLOCK HRS: 08:01 CREDIT HRS: 23:30 TAFB: 80:57"),
      1,
      "ANC"
    );
    const trip8 = tripFrom(
      rows("8", "SU REPORT AT 0742 (*2342) STANDARD CREW", "EFFECTIVE OCTOBER 4 ONLY", [
        "04SU 6031 83 ANC 0842(0042) CAN 2007(0407) 11:25 BH/DH 11:25 11:25 12:55 CAN 21:43",
        "#05MO 5419 83 CAN 1920(0320) SIN 2328(0728) 04:08 BSI 04:08 04:08 05:38 SIN 31:57",
        "07WE 5601 83 SIN 0855(1655) ANC 2126(1326) 12:31 DH/BH 12:31 12:31 14:01",
      ], "LDGS: 3 BLOCK HRS: 28:04 CREDIT HRS: 28:04 TAFB: 86:14"),
      5,
      "ANC"
    );
    // Trip 132 is released 0006 on Oct 3, and trip 8 reports 2342 that night: the 3rd's last row is empty on the pack.
    expect(daysOf([trip132, trip8]).slice(3, 8)).toEqual([["ICN"], ["ICN"], ["5161"], ["CAN"], ["CAN"]]);
  });

  it("starts a deadhead into or out of another country two hours early (B777 ANC FO line 2018, trip 2047)", () => {
    const trip2047 = tripFrom(
      [
        "2047 WE REPORT AT 1533 (0733) 1 RFO",
        "EFFECTIVE OCTOBER 7 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "07WE 5313 83 ANC 1633(0833) SIN 0607(1407) 13:34 BH/DH 13:34 13:34 15:04 SIN 32:38",
        "#09FR SQ0478 JET SIN 1715(0115) JNB 0410(0610) 10:55 S 00:00 10:55 13:25 JNB 38:15",
        "11SU 0007 84 JNB 1955(2155) NBO 2359(0259) 04:04 DH/BH",
        "12MO 0007 84 NBO 0129(0429) CDG 1019(1219) 08:50 12:54 12:54 15:54 CDG 40:58",
        "14WE 5384 83 CDG 0447(0647) CAN 1717(0117) 12:30 BH/DH 12:30 12:30 14:00 CAN 26:43",
        "#15TH 6014 83 CAN 2130(0530) ANC 0718(2318) 09:48 BH/DH 09:48 09:48 11:18",
        "LDGS: 0 BLOCK HRS: 48:46 CREDIT HRS: 64:30 T TAFB: 208:15",
      ],
      9,
      "ANC"
    );
    // SQ0478 leaves Singapore at 0115 on the 10th: the pack prints its D/H the night before, JNB on the 10th.
    expect(daysOf([trip2047]).slice(9, 14)).toEqual([["5313", "SIN"], ["SIN"], ["D/H"], ["JNB"], ["0007"]]);
  });

  it("starts a ride by road when it leaves, after the layover city (B767 MEM line 1082, trip 616)", () => {
    const trip616 = tripFrom(
      [
        "616 TH REPORT AT 1810 (1310) STANDARD CREW",
        "EFFECTIVE OCTOBER 1 - OCTOBER 22",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "TH 0253 76 MEM 1910(1410) GDL 2227(1627) 03:17 DSI",
        "TH 0253 76 GDL 2327(1727) TLC 0033(1833) 01:06 04:23 04:23 06:53 TLC 11:32",
        "FR GT9999 CAB TLC 1235(0635) MEX 1435(0835) 02:00 S",
        "FR UA1089 JET MEX 1535(0935) IAH 1755(1255) 02:20 S",
        "FR UA4054 JET IAH 2130(1630) MEM 2316(1816) 01:46 S 00:00 05:36 11:11",
        "LDGS: 2 BLOCK HRS: 04:23 CREDIT HRS: 09:59 TAFB: 29:36",
      ],
      3,
      "MEM"
    );
    expect(daysOf([trip616]).slice(3, 5)).toEqual([["0253", "0253"], ["TLC", "D/H", "D/H", "D/H"]]);
  });

  it("prints the city on a whole day at a layover reached across the date line (B777 ANC FO line 2031, trip 2032)", () => {
    const trip2032 = tripFrom(
      [
        "2032 FR REPORT AT 1835 (1035) 1 RFO",
        "EFFECTIVE OCTOBER 23 ONLY",
        "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
        "23FR 5432 83 ANC 1935(1135) ICN 0505(1405) 09:30 DH/BH 09:30 09:30 11:00 ICN 19:10",
        "25SU UA0806 JET ICN 0245(1145) SFO 1325(0625) 10:40 S",
        "25SU GT9999 CAB SFO 1355(0655) OAK 1525(0825) 01:30 S 00:00 11:40 14:40 OAK 47:36",
        "27TU 6087 83 OAK 1601(0901) SYD 0700(1800) 14:59 BH/DH 14:59 14:59 16:29 SYD 24:45",
        "29TH 6061 83 SYD 0915(2015) CAN 1900(0300) 09:45 DH/BH 09:45 09:45 11:15 CAN 49:00",
        "#31SA 6172 83 CAN 2130(0530) ANC 0718(2318) 09:48 BH/DH 09:48 09:48 11:18",
        "LDGS: 0 BLOCK HRS: 44:02 CREDIT HRS: 59:42 T TAFB: 205:13",
      ],
      25,
      "ANC"
    );
    // Seoul to San Francisco lands the same date it left: the 26th in Oakland is a whole day there.
    expect(daysOf([trip2032]).slice(25, 30)).toEqual([["5432", "ICN"], ["ICN"], ["D/H", "D/H", "OAK"], ["OAK"], ["6087", "SYD"]]);
  });

  it("never prints more than a day's cell holds", () => {
    expect(Math.max(...row.map((d) => d.tokens.length))).toBeLessThanOrEqual(PACK_TOKENS_PER_DAY);
  });
});
