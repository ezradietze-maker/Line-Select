import { describe, expect, it } from "vitest";
import { compactBidPack, expandBidPack } from "@/lib/bidpack-storage";
import { openTripsOfSeat, pairingDates, pairingDayIndex, pairingForSeat } from "@/lib/pdf-parser/open-trips";
import { parsePairingPages } from "@/lib/pdf-parser/pairing-parser";
import type { ParsedPairing } from "@/lib/pdf-parser/types";
import type { BidPack } from "@/types/bidpack";

// As the October 2026 MD-11 pack prints them: 37 departs MEM at 19:19 local, 00:19 GMT the next day, and its header days are the GMT ones.
const ROWS = [
  "37 TU REPORT AT 2319 (1819) STANDARD CREW",
  "EFFECTIVE SEPTEMBER 29 - OCTOBER 6",
  "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
  "*TU DL2939 JET MEM 0019(1919) ATL 0143(2143) 01:24 S",
  "*TU DL1229 JET ATL 0245(2245) FLL 0440(0040) 01:55 S 00:00 03:54 05:51",
  "LDGS: 0 BLOCK HRS: 00:00 CREDIT HRS: 03:54 TAFB: 05:51",
  "........................................................................................",
  "2 FR REPORT AT 1554 (1054) 1 RFO",
  "EFFECTIVE OCTOBER 9 - OCTOBER 23",
  "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
  "09FR AA1710 JET MEM 1654(1154) DFW 1842(1342) 01:48 S 00:00 01:48 02:48",
  "LDGS: 0 BLOCK HRS: 00:00 CREDIT HRS: 01:48 TAFB: 02:48",
];
const pairings: ParsedPairing[] = parsePairingPages([{ rows: ROWS, pageNumber: 1 }], []);
const pack = { bidPeriodStart: "2026-09-28", bidPeriodDays: 28, base: "MEM" };

describe("a pairing's dates", () => {
  it("keeps what its header prints", () => {
    expect(pairings[0]).toMatchObject({ sequenceNumber: "37", operatesOn: ["TU"], crew: "STANDARD CREW" });
    expect(pairings[1]).toMatchObject({ sequenceNumber: "2", operatesOn: ["FR"], crew: "1 RFO" });
  });
  it("is every printed weekday inside the printed range", () => {
    expect(pairingDates(pairings[0], "2026-09-28")).toEqual(["2026-09-29", "2026-10-06"]);
    expect(pairingDates(pairings[1], "2026-09-28")).toEqual(["2026-10-09", "2026-10-16", "2026-10-23"]);
    expect(pairingDates({ effectiveText: "OCTOBER 2 ONLY", operatesOn: ["FR"] }, "2026-09-28")).toEqual(["2026-10-02"]);
  });
  it("crosses New Year", () => {
    expect(pairingDates({ effectiveText: "DECEMBER 29 - JANUARY 5", operatesOn: ["TU"] }, "2026-12-28")).toEqual(["2026-12-29", "2027-01-05"]);
  });
  it("reads none from what it can't", () => {
    expect(pairingDates({ effectiveText: "SOMETIME", operatesOn: ["TU"] }, "2026-09-28")).toEqual([]);
  });
  it("sits on the grid by the base's date: Tuesday GMT is Monday in Memphis, the first day of the month", () => {
    expect(pairingDayIndex(pairings[0], "2026-09-29", pack)).toBe(0);
    expect(pairingDayIndex(pairings[0], "2026-10-06", pack)).toBe(7);
  });
});

describe("pairingForSeat, as the October 2026 lines use them", () => {
  it("a standard crew is both seats'", () => {
    expect(pairingForSeat("STANDARD CREW", "CAP")).toBe(true);
    expect(pairingForSeat("STANDARD CREW", "FO")).toBe(true);
  });
  it("1 RFO and 1 F/O are First Officers'", () => {
    expect(pairingForSeat("1 RFO", "CAP")).toBe(false);
    expect(pairingForSeat("1 RFO", "FO")).toBe(true);
    expect(pairingForSeat("1 F/O", "CAP")).toBe(false);
  });
  it("1 RF2 and 1 CAP are Captains'", () => {
    expect(pairingForSeat("1 RF2", "CAP")).toBe(true);
    expect(pairingForSeat("1 RF2", "FO")).toBe(false);
    expect(pairingForSeat("1 CAP", "FO")).toBe(false);
  });
});

describe("openTripsOfSeat", () => {
  const open = (held: Record<string, number[]>, seat: "CAP" | "FO" = "CAP") => openTripsOfSeat(pairings, new Map(Object.entries(held)), seat, "OCT26", pack);

  it("is every date no line holds", () => {
    expect(open({ "37": [0] }).map((t) => [t.pairingNumber, t.startDayIndex])).toEqual([["37", 7]]);
  });
  it("a date held by a line isn't open", () => {
    expect(open({ "37": [0, 7] })).toEqual([]);
  });
  it("leaves out a pairing this seat doesn't fly", () => {
    expect(open({}, "CAP").map((t) => t.pairingNumber)).not.toContain("2");
    expect(open({}, "FO").map((t) => t.pairingNumber)).toContain("2");
  });
  it("leaves out dates outside the bid month", () => {
    const short = openTripsOfSeat(pairings, new Map(), "CAP", "OCT26", { ...pack, bidPeriodDays: 7 });
    expect(short.map((t) => t.startDayIndex)).toEqual([0]);
  });
  it("is empty without the pack's dates", () => {
    expect(openTripsOfSeat(pairings, new Map(), "CAP", "OCT26", { ...pack, bidPeriodStart: null })).toEqual([]);
  });
  it("round-trips through storage, sharing the trip table", () => {
    const trips = open({});
    const full: BidPack = { id: "p", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [], openPairings: trips };
    const stored = compactBidPack(full);
    expect(stored.openPairings?.map((o) => o.startDayIndex)).toEqual([0, 7]);
    expect(Object.keys(stored.tripTable)).toHaveLength(1);
    const back = expandBidPack(JSON.parse(JSON.stringify(stored)));
    expect(back.openPairings?.map((t) => [t.pairingNumber, t.startDayIndex])).toEqual([["37", 0], ["37", 7]]);
  });
});
