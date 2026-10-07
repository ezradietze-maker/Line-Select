import { describe, expect, it } from "vitest";
import { parsePairingColumn, parsePairingPages } from "@/lib/pdf-parser/pairing-parser";
import type { ParseWarning } from "@/lib/pdf-parser/types";

// Row shapes below are copied verbatim (column-separated, not the raw
// merged-column text) from real October 2026 FedEx bid pack PDFs — see the
// ground-duty/flight-number-normalization fixes these guard.

describe("parsePairingColumn", () => {
  it("parses a normal flown leg, including its international layover", () => {
    const rows = [
      "3 TU REPORT AT 0520 (*2120) STANDARD CREW",
      "EFFECTIVE SEPTEMBER 29 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "*29TU 6017 83 ANC 0620(2220) CAN 1732(0132) 11:12 DH/BH 11:12 11:12 12:42 CAN 49:28",
      "Hotel: WHITE SWAN (CAN), +86-20-8188-6968",
      "#06TU 6014 83 CAN 2130(0530) ANC 0718(2318) 09:48 BH/DH 09:48 09:48 11:18",
      "LDGS: 2 BLOCK HRS: 21:00 CREDIT HRS: 24:00 T TAFB: 194:28",
    ];
    const warnings: ParseWarning[] = [];
    const [pairing] = parsePairingColumn(rows, 15, warnings);

    expect(warnings).toHaveLength(0);
    expect(pairing.sequenceNumber).toBe("3");
    expect(pairing.landings).toBe(2);
    expect(pairing.international).toBe(true);
    expect(pairing.layoverCities).toEqual(["CAN"]);
    expect(pairing.layoverDetails[0]).toEqual({ city: "CAN", hotelName: "WHITE SWAN" });
    expect(pairing.flightNumbers).toEqual(["6017", "6014"]);
    expect(pairing.creditHours).toBeCloseTo(24, 5);
    expect(pairing.blockHours).toBeCloseTo(21, 5);
  });

  it("recognizes ground-duty (reserve/standby) rows instead of skipping the whole pairing", () => {
    // Real shape: no EQP column at all, and the duty code ("STHOTL") has no
    // digits — the exact pattern that used to make tryParseLeg reject every
    // row in a reserve pairing, dropping it entirely.
    const rows = [
      "2 MO TU REPORT AT 2000 (1200) STANDARD CREW",
      "EFFECTIVE SEPTEMBER 28 - SEPTEMBER 29",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "1 STHOTL ANC 2000(1200) ANC 0730(2330) 11:30 S 00:00 03:12 00:00 ANC 12:30",
      "Hotel: HILTON 907/272-7411 (ANC), +1-907-272-7411",
      "2 STHOTL ANC 2000(1200) ANC 0730(2330) 11:30 S 00:00 03:12 00:00",
      "LDGS: 0 BLOCK HRS: 00:00 CREDIT HRS: 15:52 T TAFB: 36:30",
    ];
    const warnings: ParseWarning[] = [];
    const [pairing] = parsePairingColumn(rows, 15, warnings);

    expect(warnings).toHaveLength(0);
    expect(pairing.landings).toBe(0);
    expect(pairing.deadheadLegs).toBe(0);
    expect(pairing.days).toBe(2);
    expect(pairing.layoverCities).toEqual(["ANC"]);
    expect(pairing.layoverDetails[0]?.hotelName).toBe("HILTON");
    // Footer stays the source of truth for credit/block/TAFB — never summed
    // from the ambiguous per-day duty-length field on a ground-duty row.
    expect(pairing.creditHours).toBeCloseTo(15 + 52 / 60, 5);
    expect(pairing.blockHours).toBe(0);
    expect(pairing.flightNumbers).toEqual(["STHOTL", "STHOTL"]);
  });

  it("still skips a pairing with genuinely no readable legs, ground-duty or otherwise", () => {
    const rows = [
      "1 MO REPORT AT 0900 (0300) STANDARD CREW",
      "EFFECTIVE OCTOBER 1 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "garbled unreadable row that matches nothing",
      "LDGS: 0 BLOCK HRS: 00:00 CREDIT HRS: 03:12 T TAFB: 11:30",
    ];
    const warnings: ParseWarning[] = [];
    const result = parsePairingColumn(rows, 15, warnings);

    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("no readable flight legs");
  });
});

describe("deadheads and the MEAL column", () => {
  it("does not count a company leg as a deadhead because its meal code is DH (dinner, hot)", () => {
    const rows = [
      "3 TU REPORT AT 0520 (*2120) STANDARD CREW",
      "EFFECTIVE SEPTEMBER 29 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "*29TU 6017 83 ANC 0620(2220) CAN 1732(0132) 11:12 DH/BH 11:12 11:12 12:42 CAN 49:28",
      "#06TU 6014 83 CAN 2130(0530) ANC 0718(2318) 09:48 DH 09:48 09:48 11:18",
      "LDGS: 2 BLOCK HRS: 21:00 CREDIT HRS: 24:00 T TAFB: 194:28",
    ];
    const [pairing] = parsePairingColumn(rows, 15, []);
    expect(pairing.deadheadLegs).toBe(0);
    expect(pairing.landings).toBe(2);
    expect(pairing.schedule.flatMap((d) => d.legs).every((l) => !l.isDeadhead)).toBe(true);
  });

  // Real B767 MEM pairing 10: two interline rides out (an airliner, then a
  // cab between airports), a layover printed on the cab row, then flying.
  const cabRows = [
    "10 MO REPORT AT 2345 (1845) STANDARD CREW",
    "EFFECTIVE OCTOBER 5 ONLY",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "*05MO AA3932 JET MEM 0045(1945) DFW 0230(2130) 01:45 S",
    "*05MO GT9999 CAB DFW 0300(2200) AFW 0350(2250) 00:50 S 00:00 03:12 04:05 AFW 21:20",
    "Hotel: CY BLACKSTONE (AFW), +1-817-855-8700",
    "*06TU 1058 76 AFW 0210(2110) DFW 0249(2149) 00:39",
    "*06TU 1058 76 DFW 0350(2250) GSO 0605(0205) 02:15 02:54 03:37 05:25 GSO 18:21",
    "Hotel: MARRIOTT GSO (GSO), +1-336-379-8000",
    "*07WE 1248 76 GSO 0156(2156) MEM 0353(2253) 01:57 01:57 03:12 03:27",
    "LDGS: 3 BLOCK HRS: 04:51 CREDIT HRS: 14:02 T TAFB: 52:38",
  ];

  it("counts interline flights, cab rides included, as deadheads", () => {
    const [pairing] = parsePairingColumn(cabRows, 15, []);
    expect(pairing.deadheadLegs).toBe(2);
    expect(pairing.landings).toBe(3);
    const legs = pairing.schedule.flatMap((d) => d.legs);
    expect(legs.map((l) => l.isDeadhead)).toEqual([true, true, false, false, false]);
  });

  it("keeps a layover printed on a CAB row instead of dropping the row and merging duty days", () => {
    const [pairing] = parsePairingColumn(cabRows, 15, []);
    expect(pairing.layoverCities).toEqual(["AFW", "GSO"]);
    expect(pairing.schedule).toHaveLength(3);
    expect(pairing.schedule[0].legs[1].equipment).toBe("CAB");
    expect(pairing.schedule[0].layover?.hours).toBeCloseTo(21 + 20 / 60, 5);
  });

  it("does not read a 3-letter meal code on a trip's final leg as a layover city", () => {
    // Real ICN→HKG row (B777 MEM) as the pairing's last leg: no layover
    // column, so "DSI 04:16" must not become a 4.3-hour stop in "DSI".
    const rows = [
      "7 WE REPORT AT 0330 (*1930) STANDARD CREW",
      "EFFECTIVE SEPTEMBER 30 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "*30WE 5236 83 ANC 0500(2100) ICN 1435(2335) 09:35 DH/BH 09:35 09:35 11:05 ICN 37:00",
      "Hotel: GRAND HYATT 82-2-797-1234 (ICN), +82-2-797-1234",
      "02FR 5991 83 ICN 0505(1405) HKG 0921(1721) 04:16 DSI 04:16 04:16 05:46",
      "LDGS: 2 BLOCK HRS: 13:51 CREDIT HRS: 13:51 T TAFB: 55:51",
    ];
    const [pairing] = parsePairingColumn(rows, 15, []);
    expect(pairing.layoverCities).toEqual(["ICN"]);
    expect(pairing.layoverCities).not.toContain("DSI");
  });
});

describe("hotel standby", () => {
  it("counts each standby duty row as one standby day, and the pairing flies nothing", () => {
    // Real shape (A300 MEM pairing 75): two interline positioning flights, then
    // one STHOTL row per standby day at the layover hotel.
    const rows = [
      "75 MO REPORT AT 2209 (1709) STANDARD CREW",
      "EFFECTIVE SEPTEMBER 28 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "28MO DL1681 JET MEM 2309(1809) ATL 0029(2029) 01:20 S",
      "*29TU DL3153 JET ATL 0150(2150) IND 0322(2322) 01:32 S 00:00 03:49 05:43 IND 19:38",
      "Hotel: HYATT PLACE HYATT HOUSE (IND), +1-317-762-8000",
      "29TU STHOTL IND 2330(1930) IND 1100(0700) 11:30 S 00:00 03:12 00:00 IND 12:30",
      "Hotel: HYATT PLACE HYATT HOUSE (IND), +1-317-762-8000",
      "30WE STHOTL IND 2330(1930) IND 1100(0700) 11:30 S 00:00 03:12 00:00 IND 12:30",
      "Hotel: HYATT PLACE HYATT HOUSE (IND), +1-317-762-8000",
      "01TH STHOTL IND 2330(1930) IND 1100(0700) 11:30 S 00:00 03:12 00:00",
      "LDGS: 0 BLOCK HRS: 02:52 CREDIT HRS: 26:45 T TAFB: 91:00",
    ];
    const warnings: ParseWarning[] = [];
    const [pairing] = parsePairingColumn(rows, 15, warnings);

    expect(pairing.standbyDays).toBe(3);
    expect(pairing.landings).toBe(0);
  });

  it("reports zero standby days for an ordinary flying pairing", () => {
    const rows = [
      "3 TU REPORT AT 0520 (*2120) STANDARD CREW",
      "EFFECTIVE SEPTEMBER 29 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "*29TU 6017 83 ANC 0620(2220) CAN 1732(0132) 11:12 DH/BH 11:12 11:12 12:42 CAN 49:28",
      "#06TU 6014 83 CAN 2130(0530) ANC 0718(2318) 09:48 BH/DH 09:48 09:48 11:18",
      "LDGS: 2 BLOCK HRS: 21:00 CREDIT HRS: 24:00 T TAFB: 194:28",
    ];
    const [pairing] = parsePairingColumn(rows, 15, []);
    expect(pairing.standbyDays).toBe(0);
  });
});

describe("parsePairingPages", () => {
  it("joins a pairing split across a page break into one pairing, without the page title in the middle", () => {
    // Real shape (B777 MEM pp. 118-119): a pairing starts at the bottom of one
    // page and its second leg and summary line print at the top of the next,
    // under that page's own title row.
    const page1 = [
      "5 TU REPORT AT 2016 (1516) STANDARD CREW",
      "EFFECTIVE OCTOBER 13 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "13TU UA1347 JET MEM 2116(1616) DEN 2356(1756) 02:40 S 00:00 03:12 04:10 DEN 09:34",
      "Hotel: HAMPTON INN (DEN), 303-375-8118",
    ];
    const page2 = [
      "OCTOBER 2026 BID PACK PAIRING SCHEDULE FOR B777 MEM",
      "14WE UA2367 JET DEN 1100(0500) MEM 1341(0841) 02:41 S 00:00 03:41 05:41",
      "LDGS: 2 BLOCK HRS: 05:21 CREDIT HRS: 06:53 T TAFB: 22:00",
      "6 WE REPORT AT 0900 (0400) STANDARD CREW",
      "EFFECTIVE OCTOBER 14 ONLY",
      "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
      "14WE UA0100 JET MEM 1000(0500) ORD 1130(0630) 01:30 S 00:00 03:12 02:30",
      "LDGS: 1 BLOCK HRS: 01:30 CREDIT HRS: 03:12 T TAFB: 04:00",
    ];
    const warnings: ParseWarning[] = [];
    const pairings = parsePairingPages(
      [
        { rows: page1, pageNumber: 118 },
        { rows: page2, pageNumber: 119 },
      ],
      warnings
    );

    // (Soft timeline-reconcile warnings from this hand-made fixture's hours are fine; a dropped pairing is not.)
    expect(warnings.filter((w) => w.message.startsWith("Skipped"))).toEqual([]);
    expect(pairings.map((p) => p.sequenceNumber)).toEqual(["5", "6"]);
    expect(pairings[0].flightNumbers).toEqual(["UA1347", "UA2367"]);
    expect(pairings[0].pageNumber).toBe(118);
  });

  it("still warns about a pairing that never finishes, on the last page", () => {
    const warnings: ParseWarning[] = [];
    const pairings = parsePairingPages(
      [
        {
          rows: [
            "5 TU REPORT AT 2016 (1516) STANDARD CREW",
            "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
            "13TU UA1347 JET MEM 2116(1616) DEN 2356(1756) 02:40 S 00:00 03:12 04:10 DEN 09:34",
          ],
          pageNumber: 118,
        },
      ],
      warnings
    );
    expect(pairings).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});

describe("layover hotels, day rooms and pickups", () => {
  // Real pairing 4001 (B767 MEM, Oct 2026): MIA overnight, then MIA → GUA
  // with a few hours at a GUA hotel mid-duty, GUA → SAP → MIA, MIA overnight.
  const rows = [
    "4001 MO REPORT AT 1118 (0618) STANDARD CREW",
    "EFFECTIVE SEPTEMBER 28 - OCTOBER 5",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "MO DL1624 JET MEM 1218(0718) ATL 1336(0936) 01:18 S",
    "MO DL1332 JET ATL 1507(1107) MIA 1705(1305) 01:58 S 00:00 03:16 06:17 MIA 19:25",
    "Trans To: BESPOKE TRANSPORTATION (MIA), +1-212-203-0706, pickup @1705 (1305)",
    "Hotel: COURTYARD MIAMI COCONUT GROVE (MIA), +1-305-858-2500",
    "Trans From: BESPOKE TRANSPORTATION (MIA), +1-212-203-0706, pickup @1230 (0830)",
    "TU 5503 72 MIA 1400(1000) GUA 1633(1033) 02:33 BH",
    "Trans To: BESPOKE TRANSPORTATION (GUA), +1-800-905-2103, pickup @1633 (1033)",
    "Hotel: REAL INTERCONTINENTAL GUATEMALA (GUA), MAIN",
    "Trans From: BESPOKE TRANSPORTATION (GUA), +1-800-905-2103, pickup @1902 (1302)",
    "TU 5504 72 GUA 2047(1447) SAP 2146(1546) 00:59 DH",
    "TU 5504 72 SAP 2316(1716) MIA 0129(2129) 02:13 05:45 07:30 12:59 MIA 35:01",
    "Trans To: CAREY LIMOUSINE INDIANA, INC. (MIA),",
    "+1-317-240-6190, pickup @0129 (*2129)",
    "Hotel: COURTYARD MIAMI COCONUT GROVE (MIA), +1-305-858-2500",
    "Trans From: CAREY LIMOUSINE INDIANA, INC. (MIA),",
    "+1-317-240-6190, pickup @1230 (0830)",
    "TH 5503 72 MIA 1400(1000) MEM 1633(1133) 02:33 02:33 03:30 04:03",
    "LDGS: 4 BLOCK HRS: 08:18 CREDIT HRS: 20:00 T TAFB: 76:15",
  ];

  it("never lets a mid-duty stop's hotel overwrite the overnight layover's", () => {
    const [pairing] = parsePairingColumn(rows, 176, []);
    expect(pairing.layoverDetails.map((d) => d.hotelName)).toEqual(["COURTYARD MIAMI COCONUT GROVE", "COURTYARD MIAMI COCONUT GROVE"]);
    expect(pairing.schedule.map((d) => d.layover?.hotelName ?? null)).toEqual(["COURTYARD MIAMI COCONUT GROVE", "COURTYARD MIAMI COCONUT GROVE", null]);
    expect(pairing.schedule[0].layover?.transportFromHotel).toBe("BESPOKE TRANSPORTATION");
  });

  it("keeps the mid-duty hotel as that stop's day room", () => {
    const [pairing] = parsePairingColumn(rows, 176, []);
    const gua = pairing.schedule[1].legs.find((l) => l.arrAirport === "GUA");
    expect(gua?.dayRoomHotel).toBe("REAL INTERCONTINENTAL GUATEMALA");
    expect(pairing.schedule[1].legs.filter((l) => l.dayRoomHotel)).toHaveLength(1);
  });

  it("reads the printed pickup, on the same line or wrapped onto the next", () => {
    const [pairing] = parsePairingColumn(rows, 176, []);
    expect(pairing.schedule[0].layover).toMatchObject({ pickupTimeGmt: "1230", pickupTimeLocal: "0830" });
    expect(pairing.schedule[1].layover).toMatchObject({ pickupTimeGmt: "1230", pickupTimeLocal: "0830", transportToHotel: "CAREY LIMOUSINE INDIANA, INC." });
  });

  it("starts the next duty at the printed pickup, 90 minutes before the 14:00Z departure", () => {
    const [pairing] = parsePairingColumn(rows, 176, []);
    const [first, second] = pairing.schedule;
    expect(second.legs[0].startMinutes - second.startMinutes).toBe(90);
    expect(first.layover?.endMinutes).toBe(second.startMinutes);
  });
});
