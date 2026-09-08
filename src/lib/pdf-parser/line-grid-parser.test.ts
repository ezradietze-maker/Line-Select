import { describe, expect, it } from "vitest";
import { indexPairingsByFlightNumber, indexPairingsBySequence, parseLineGridColumn } from "@/lib/pdf-parser/line-grid-parser";
import type { ParsedPairing, ParseWarning } from "@/lib/pdf-parser/types";

function makePairing(overrides: Partial<ParsedPairing> = {}): ParsedPairing {
  return {
    id: "p-1",
    sequenceNumber: "99",
    pageNumber: 1,
    days: 2,
    layoverCities: ["MEM"],
    layoverDetails: [],
    reportTime: "afternoon",
    reportTimeLocal: "1200",
    international: false,
    deadheadLegs: 0,
    creditHours: 12,
    blockHours: 10,
    landings: 3,
    tafbHours: 40,
    effectiveText: "",
    firstFlightNumber: "762",
    flightNumbers: ["762"],
    schedule: [],
    ...overrides,
  };
}

describe("parseLineGridColumn", () => {
  it("matches a grid cell's flight number to a pairing whose own schedule prints it with different zero-padding", () => {
    // Real bug: the line grid printed a deadhead flight as "0762" while the
    // pairing schedule itself carried it as "762" — indexPairingsByFlightNumber
    // strips leading zeros when building its keys, but the lookup used the
    // grid's raw, un-normalized candidate text, so a real match was silently
    // missed and the line fell back to "totals only."
    const pairing = makePairing();
    const pairingsBySeq = indexPairingsBySequence([pairing]);
    const pairingsByFlightNumber = indexPairingsByFlightNumber([pairing]);

    const rows = [
      "LINE 1124 * | 0762: : : : | : | CR. 12:00 TAFB 40:00 | : : : : | : | C/O. 0:00 NO. DP’S 1 | : : : : | : | BLK. 10:00 LANDINGS 3 | : : : : | : | C/O. 0:00 DAYS OFF 13",
    ];
    const warnings: ParseWarning[] = [];
    const [result] = parseLineGridColumn(rows, 202, "CAP", pairingsBySeq, pairingsByFlightNumber, warnings);

    expect(warnings).toHaveLength(0);
    expect(result.pairings).not.toBeNull();
    expect(result.pairings).toEqual([pairing]);
  });

  it("weights a flight-number match by how many times it actually occurs, not a flat 1", () => {
    // Real bug: a trip repeated across several weeks in the same line often
    // only shows up via its deadhead flight number (no bare sequence-number
    // cell for the repeat weeks at all) — a flat weight of 1 per match
    // under-counts a pairing that's genuinely flown more than once, making
    // an otherwise-solvable line impossible to match within tolerance.
    const pairing = makePairing({ id: "p-repeat", creditHours: 10, blockHours: 8, landings: 2 });
    const pairingsBySeq = indexPairingsBySequence([]);
    const pairingsByFlightNumber = indexPairingsByFlightNumber([pairing]);

    // "762" (this pairing's own flight number) appears three times, once per
    // week, with no sequence-number cell anywhere — flown 3x this month.
    const rows = [
      "LINE 1124 * | 762: : : : | : | CR. 30:00 TAFB 40:00 | 762: : : : | : | C/O. 0:00 NO. DP’S 3 | 762: : : : | : | BLK. 24:00 LANDINGS 6 | : : : : | : | C/O. 0:00 DAYS OFF 13",
    ];
    const warnings: ParseWarning[] = [];
    const [result] = parseLineGridColumn(rows, 202, "CAP", pairingsBySeq, pairingsByFlightNumber, warnings);

    expect(warnings).toHaveLength(0);
    expect(result.pairings).toEqual([pairing, pairing, pairing]);
  });

  it("ignores the bare, un-piped run of numbers that trails DAYS OFF, even when one coincidentally matches a real pairing", () => {
    // Real bug: real bid packs print an unrelated trailing summary run right
    // after "DAYS OFF NN" (bare numbers, no colons/pipes at all) that
    // matches no actual pairing anywhere — but the candidate regex still
    // picked it up (a bare space is an accepted terminator), inflating a
    // real candidate's occurrence-based weight whenever the two coincide,
    // as happened here with a real bid pack's own sequence number 624.
    const pairing = makePairing({ id: "p-42", sequenceNumber: "42", creditHours: 12, blockHours: 10, landings: 3 });
    const pairingsBySeq = indexPairingsBySequence([pairing]);
    const pairingsByFlightNumber = indexPairingsByFlightNumber([]);

    const rows = [
      "LINE 1124 * | 42: : : : | : | CR. 12:00 TAFB 40:00 | : : : : | : | C/O. 0:00 NO. DP’S 1 | : : : : | : | BLK. 10:00 LANDINGS 3 | : : : : | : | C/O. 0:00 DAYS OFF 13 | 42 99",
    ];
    const warnings: ParseWarning[] = [];
    const [result] = parseLineGridColumn(rows, 202, "CAP", pairingsBySeq, pairingsByFlightNumber, warnings);

    expect(warnings).toHaveLength(0);
    // Weight 1, not 2 — the trailing "42" must not count as a second real reference.
    expect(result.pairings).toEqual([pairing]);
  });

  it("still falls back to totals-only when no candidate resolves to a real pairing", () => {
    const pairingsBySeq = indexPairingsBySequence([]);
    const pairingsByFlightNumber = indexPairingsByFlightNumber([]);

    const rows = [
      "LINE 1125 * | 9999: : : : | : | CR. 12:00 TAFB 40:00 | : : : : | : | C/O. 0:00 NO. DP’S 1 | : : : : | : | BLK. 10:00 LANDINGS 3 | : : : : | : | C/O. 0:00 DAYS OFF 13",
    ];
    const warnings: ParseWarning[] = [];
    const [result] = parseLineGridColumn(rows, 202, "CAP", pairingsBySeq, pairingsByFlightNumber, warnings);

    expect(result.pairings).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("couldn't confidently match");
  });
});
