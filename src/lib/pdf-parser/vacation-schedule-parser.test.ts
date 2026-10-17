import { describe, expect, it } from "vitest";
import { extractVacationScheduleSeat, parseSweepFlightRows, parseVacationScheduleRows } from "@/lib/pdf-parser/vacation-schedule-parser";

// Invented rows in the layout of a real "Vacation Schedule by Week" page: two blocks to a row, the week number on the first.
describe("vacation schedule parsing", () => {
  it("reads the seat from the page header", () => {
    expect(extractVacationScheduleSeat(["MEM11 Page 1", "OCT26 Vacation Schedule by Week: CAP"])).toBe("CAP");
    expect(extractVacationScheduleSeat(["OCT26 Vacation Schedule by Week: F/O"])).toBe("FO");
  });

  it("keeps each block's seniority number, days and Zulu dates", () => {
    const rows = ["39 DOE, JANE 5282517 2811 07 03OCT26 0630 10OCT26 0629 ROE, RICHARD 625920 1510 12 12OCT26 0630 24OCT26 0629"];
    expect(parseVacationScheduleRows(rows)).toEqual([
      { seniority: 2811, period: { from: "2026-10-03T06:30:00Z", to: "2026-10-10T06:29:00Z", days: 7 } },
      { seniority: 1510, period: { from: "2026-10-12T06:30:00Z", to: "2026-10-24T06:29:00Z", days: 12 } },
    ]);
  });

  it("never carries a name or an employee number through", () => {
    const serialized = JSON.stringify(parseVacationScheduleRows(["DOE, JANE 5282517 2811 07 03OCT26 0630 10OCT26 0629"]));
    for (const secret of ["DOE", "JANE", "5282517"]) expect(serialized).not.toContain(secret);
  });
});

describe("sweep flight parsing", () => {
  it("reads each flight number and departure city once", () => {
    expect(parseSweepFlightRows(["400 (OAK) 1374 (HTS)", "402 (GEG)", "400 (OAK)"])).toEqual([
      { flightNumber: "400", from: "OAK" },
      { flightNumber: "1374", from: "HTS" },
      { flightNumber: "402", from: "GEG" },
    ]);
  });
});
