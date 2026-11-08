import { describe, expect, it } from "vitest";
import { extractReserveLineSeat, parseReserveLineDays, parseReserveLineGridRows } from "@/lib/pdf-parser/reserve-line-parser";
import type { ParseWarning } from "@/lib/pdf-parser/types";

describe("parseReserveLineGridRows", () => {
  it("parses real line-number + R/A/B grid rows into line number and reserve type", () => {
    const rows = [
      "Reserve Lines: CAP",
      "Period Type: R (24-Hr) | A (RA) | B (RB)",
      "7001 |R R R R R|R R|R R R R R|R R|R | | | | | | | |",
      "7006 | | | A A|A A|A A A A A|A A|A A A A | | | | | |",
      "7022 |B B B B B|B B|B B B B B|B B|B | | | | | | | |",
    ];
    const warnings: ParseWarning[] = [];
    const result = parseReserveLineGridRows(rows, 117, warnings);
    expect(result).toEqual([
      { lineNumber: "7001", reserveType: "24hr" },
      { lineNumber: "7006", reserveType: "a" },
      { lineNumber: "7022", reserveType: "b" },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("marks a line's type unknown rather than guessing when its row shows no R/A/B letters at all", () => {
    const rows = ["7099 | | | | | | | | | | | | | | | |"];
    const result = parseReserveLineGridRows(rows, 117, []);
    expect(result).toEqual([{ lineNumber: "7099", reserveType: null }]);
  });

  it("marks a line's type unknown rather than guessing when its row mixes more than one letter", () => {
    const rows = ["7050 |R R R|A A A|"];
    const result = parseReserveLineGridRows(rows, 117, []);
    expect(result).toEqual([{ lineNumber: "7050", reserveType: null }]);
  });

  it("refuses a row outright the moment it contains anything outside digits/R/A/B/pipes/whitespace — the fail-closed guard against a differently-formatted bid pack that prints names here", () => {
    const rows = [
      "7001 |R R SMITH, JOHN R R|R R|",
      "7002 |R R R R R|R R|R R R R R|R R|R R R R R|",
    ];
    const result = parseReserveLineGridRows(rows, 117, []);
    // Only the clean row survives; the row with a name embedded is dropped entirely, not partially trusted.
    expect(result).toEqual([{ lineNumber: "7002", reserveType: "24hr" }]);
  });

  it("records a warning when nothing on the page matched the expected grid shape at all", () => {
    const warnings: ParseWarning[] = [];
    parseReserveLineGridRows(["some completely different page format"], 117, warnings);
    expect(warnings).toHaveLength(1);
  });
});

describe("ranged reserve rows", () => {
  it("reads a row shared by several lines as each of them, the way a pack prints lines with one schedule", () => {
    const rows = ["7019-20|A A A A | | A A A A|A A| |A A|A A A | | | | | |", "7049-52|B B B B | |B B B B B|B | B B|B B|B | | | | | |"];
    expect(parseReserveLineGridRows(rows, 54, []).map((r) => r.lineNumber)).toEqual(["7019", "7020", "7049", "7050", "7051", "7052"]);
  });

  it("carries a range across a hundred", () => {
    expect(parseReserveLineGridRows(["7099-101|R R | |"], 54, []).map((r) => r.lineNumber)).toEqual(["7099", "7100", "7101"]);
  });

  it("still refuses a ranged row that prints anything but the grid", () => {
    expect(parseReserveLineGridRows(["7019-20|A A SMITH A|"], 54, [])).toEqual([]);
  });
});

describe("parseReserveLineDays", () => {
  // Positions as the MD-11 Memphis October pack prints them: lines 7006 (one number) and 7019-20 (a range).
  const header = { str: "|28 29 30 01 02|03 04|05 06 07 08 09|10 11", x: 67.5, y: 100 };
  const row = (y: number, cells: [number, string][]) => cells.map(([x, str]) => ({ x, y, str }));
  const line7006 = row(110, [[36, "7006"], [67, "|"], [134.5, "|R"], [154.8, "R|R"], [181.8, "R"], [195.3, "R"], [229, "|"], [256, "|"]]);
  const line7019 = row(120, [[25, "7019-20|A"], [87.3, "A"], [100.8, "A"], [114.3, "A"], [134.5, "|"], [161.5, "|"], [181.8, "A"], [195.3, "A"]]);

  it("places each letter on its day, however the blanks closed up in the text", () => {
    const days = parseReserveLineDays([header, ...line7006, ...line7019]);
    // |Mo Tu We Th Fr| = days 0–4, |Sa Su| = 5–6, |Mo…| = 7 on.
    expect(days.get("7006")).toEqual([5, 6, 7, 8, 9]);
    expect(days.get("7019")).toEqual([0, 1, 2, 3, 8, 9]);
    expect(days.get("7020")).toEqual([0, 1, 2, 3, 8, 9]);
  });

  it("reads nothing without a header to measure from, and nothing from a row with anything but the grid on it", () => {
    expect(parseReserveLineDays(line7006).size).toBe(0);
    expect(parseReserveLineDays([header, ...row(110, [[36, "7006"], [67, "|R"], [80, "SMITH"]])]).size).toBe(0);
  });
});

describe("extractReserveLineSeat", () => {
  it("reads CAP from the page header", () => {
    expect(extractReserveLineSeat(["Reserve Lines: CAP ", "Page 1"])).toBe("CAP");
  });

  it("reads F/O from the page header", () => {
    expect(extractReserveLineSeat(["Reserve Lines: F/O ", "Page 1"])).toBe("FO");
  });

  it("returns null when no header row matches", () => {
    expect(extractReserveLineSeat(["something else"])).toBeNull();
  });
});
