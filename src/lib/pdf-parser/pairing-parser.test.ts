import { describe, expect, it } from "vitest";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import type { ParseWarning } from "@/lib/pdf-parser/types";

// Row shapes below are copied verbatim (column-separated, not the raw
// merged-column text) from real October 2026 FedEx bid pack PDFs — see the
// ground-duty/flight-number-normalization fixes these guard.

describe("parsePairingColumn", () => {
  it("parses a normal flown leg, including its deadhead flag and international layover", () => {
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
