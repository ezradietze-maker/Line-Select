import { describe, expect, it } from "vitest";
import { parseInfoPage } from "@/lib/pdf-parser/info-page-parser";
import type { ParseWarning } from "@/lib/pdf-parser/types";

const REAL_ROWS = [
  "Bid Information for B767 OAK",
  "SEP26",
  "Reserve Report Status: R-3.0",
  "PSIT Email: Fedex767OAK@alpa.com",
  "CAP F/O",
  "Average BLG: 78:55 79:27",
  "RLG: 75:45 76:15",
  "The R-Day value is: 5:03 5:05",
  "High Line Credit: 83:21 83:30",
  "Low Line Credit: 70:41 70:41",
  "Average Days Off: 14.2 14.1",
  "Total # Regular Lines: CAP 98",
  "F/O 118",
  "Total # Reserve Lines: CAP 35",
  "F/O 26",
  "Total # Secondary Lines: CAP 54",
  "F/O 43",
];

describe("parseInfoPage", () => {
  it("parses every field from a real info page layout, converting HH:MM to hours", () => {
    const result = parseInfoPage(REAL_ROWS, 3, []);
    expect(result?.CAP).toEqual({
      rlgHours: 75.75,
      rDayValueHours: 5.05,
      lowLineCreditHours: 70 + 41 / 60,
      highLineCreditHours: 83 + 21 / 60,
      averageDaysOff: 14.2,
      totalRegularLines: 98,
      totalReserveLines: 35,
      totalSecondaryLines: 54,
    });
    expect(result?.FO).toEqual({
      rlgHours: 76.25,
      rDayValueHours: 5.05 + 2 / 60, // 5:05
      lowLineCreditHours: 70 + 41 / 60,
      highLineCreditHours: 83.5,
      averageDaysOff: 14.1,
      totalRegularLines: 118,
      totalReserveLines: 26,
      totalSecondaryLines: 43,
    });
  });

  it("returns null and records a warning when none of the key fields match the expected layout", () => {
    const warnings: ParseWarning[] = [];
    const result = parseInfoPage(["a completely different page"], 3, warnings);
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("leaves an individual field null rather than guessing when only that one is missing", () => {
    const rowsWithoutAverageDaysOff = REAL_ROWS.filter((r) => !r.startsWith("Average Days Off"));
    const result = parseInfoPage(rowsWithoutAverageDaysOff, 3, []);
    expect(result?.CAP?.averageDaysOff).toBeNull();
    expect(result?.CAP?.rlgHours).toBe(75.75); // everything else still parses fine
  });
});
