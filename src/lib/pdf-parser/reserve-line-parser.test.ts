import { describe, expect, it } from "vitest";
import { extractReserveLineSeat, parseReserveLineGridRows } from "@/lib/pdf-parser/reserve-line-parser";
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
