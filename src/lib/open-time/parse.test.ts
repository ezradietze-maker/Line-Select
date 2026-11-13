import { describe, expect, it } from "vitest";
import { pasteSnapshot, pasteSource, parseOpenTimePaste } from "@/lib/open-time/parse";

// Every list in this file is made up. Nobody here has seen a real VIPS open-time list.
describe("parseOpenTimePaste", () => {
  it("reads a date however it's written", () => {
    const { rows, unread } = parseOpenTimePaste(["213 14OCT", "214 14 OCT", "OCT 15 215", "October 16 216", "217 10/17", "218 2026-10-18", "219 19OCT26", "220 10/20/26"].join("\n"));
    expect(unread).toEqual([]);
    expect(rows.map((r) => [r.tripNumbers[0], r.month, r.day])).toEqual([
      ["213", 10, 14],
      ["214", 10, 14],
      ["215", 10, 15],
      ["216", 10, 16],
      ["217", 10, 17],
      ["218", 10, 18],
      ["219", 10, 19],
      ["220", 10, 20],
    ]);
    expect(rows[5].year).toBe(2026);
    expect(rows[6].year).toBe(2026);
  });

  it("doesn't take a trip number for a year", () => {
    expect(parseOpenTimePaste("14OCT 213").rows[0]).toMatchObject({ tripNumbers: ["213"], day: 14 });
  });

  it("doesn't take a count for a trip number, its label before or after it", () => {
    for (const text of ["1540 14OCT CR 12.5 TAFB 48:30 LDGS 3", "1540 14OCT 3 LDGS", "1540 14OCT DAYS 2"]) {
      expect(parseOpenTimePaste(text).rows[0].tripNumbers).toEqual(["1540"]);
    }
  });

  it("keeps a short trip number written beside a count, the label first as the pack prints it", () => {
    expect(parseOpenTimePaste("03OCT 49 LDGS 2").rows[0].tripNumbers).toEqual(["49"]);
    expect(parseOpenTimePaste("14OCT 47 LDG 2").rows[0].tripNumbers).toEqual(["47"]);
    // Either way round for hours: both left in, for the trip that flies that date to settle it.
    expect(parseOpenTimePaste("14OCT 47 HRS 12").rows[0].tripNumbers).toEqual(expect.arrayContaining(["47", "12"]));
    expect(parseOpenTimePaste("213 14OCT LDGS: 3").rows[0].tripNumbers).toEqual(["213"]);
    // Too many to be a trip's days: a trip number, not a count.
    expect(parseOpenTimePaste("14OCT DAYS 47").rows[0].tripNumbers).toEqual(["47"]);
  });

  it("believes a trip number that's labelled", () => {
    for (const text of ["Trip 213 14OCT 1430", "SEQ 213 14OCT 22", "#213 14OCT 22", "Pairing: 213 14OCT 22"]) {
      expect(parseOpenTimePaste(text).rows[0].tripNumbers).toEqual(["213"]);
    }
  });

  it("reads labelled figures, on either side of their label", () => {
    const { rows } = parseOpenTimePaste("Trip 213 14OCT CH 12.5 TAFB 48:30 RPT 0915\nTrip 214 15OCT 12:30 CH 48.5 TAFB SHOW 09:15L");
    expect(rows[0]).toMatchObject({ creditHours: 12.5, tafbHours: 48.5, reportTime: "0915" });
    expect(rows[1]).toMatchObject({ creditHours: 12.5, tafbHours: 48.5, reportTime: "0915" });
  });

  it("reads columns by their heading, so a bare figure isn't guessed at", () => {
    const { rows, headings, unread } = parseOpenTimePaste("TRIP\tDATE\tREPORT\tCREDIT\tTAFB\tROUTE\n213\t14OCT\t0915\t12:30\t48:30\tMEM-ANC-MEM\n214\t15OCT\t1430\t8.25\t26.5\tMEM-IND-MEM");
    expect(headings).toHaveLength(1);
    expect(unread).toEqual([]);
    expect(rows[0]).toMatchObject({ tripNumbers: ["213"], reportTime: "0915", creditHours: 12.5, tafbHours: 48.5 });
    expect(rows[1]).toMatchObject({ tripNumbers: ["214"], reportTime: "1430", creditHours: 8.25, tafbHours: 26.5 });
  });

  it("reads space-separated columns under a heading too", () => {
    const { rows } = parseOpenTimePaste("TRIP DATE CH\n213 14OCT 12.5");
    expect(rows[0]).toMatchObject({ tripNumbers: ["213"], creditHours: 12.5 });
  });

  it("keeps every number it can't rule out, for the pack to settle, with the likeliest first", () => {
    expect(parseOpenTimePaste("1430 213 14OCT").rows[0].tripNumbers).toEqual(["213", "1430"]);
    expect(parseOpenTimePaste("213 14OCT 1430 2245").rows[0].tripNumbers).toEqual(["213", "1430", "2245"]);
  });

  it("never takes a time or a figure for the trip", () => {
    expect(parseOpenTimePaste("10/14 0915 213").rows[0].tripNumbers).toEqual(["213"]);
    expect(parseOpenTimePaste("213 10/14 09:15 12.5").rows[0].tripNumbers).toEqual(["213"]);
    expect(parseOpenTimePaste("213 10/14 3 DAY 4 LEGS FX1234 MEM-123").rows[0].tripNumbers).toEqual(["213"]);
  });

  it("gives every row it can't read back, with why", () => {
    const { rows, unread } = parseOpenTimePaste(["Trip ?? sometime", "213", "OPEN TIME FOR MEM", "213 45OCT", "213 13/40", "14OCT", "BAS 14OCT 0800-2000"].join("\n"));
    expect(rows).toEqual([]);
    expect(unread.map((u) => u.raw)).toEqual(["Trip ?? sometime", "213", "OPEN TIME FOR MEM", "213 45OCT", "213 13/40", "14OCT", "BAS 14OCT 0800-2000"]);
    expect(unread[1].why).toContain("No date");
    expect(unread[2].why).toContain("No trip number or date");
    expect(unread[3].why).toContain("isn't a real date");
    expect(unread[4].why).toContain("isn't a real date");
    expect(unread[5].why).toContain("No trip number");
    expect(unread[6].why).toContain("standby");
  });

  it("skips rules and blank lines, and tells a heading from a row it can't read", () => {
    const { rows, unread, headings } = parseOpenTimePaste("Trip Date Credit\n-------------\n\n=== ===\n213 14OCT 12.5");
    expect(rows).toHaveLength(1);
    expect(unread).toEqual([]);
    expect(headings).toEqual(["Trip Date Credit"]);
  });

  it("keeps the pilot's own text, and copes with Windows line ends", () => {
    const { rows } = parseOpenTimePaste("  213 14OCT  \r\n214 15OCT\r\n");
    expect(rows.map((r) => r.raw)).toEqual(["213 14OCT", "214 15OCT"]);
  });

  it("CBA 2026 25.G.2.b.iii: marks a row that says it's frozen", () => {
    expect(parseOpenTimePaste("213 14OCT FROZEN").rows[0].frozen).toBe(true);
    expect(parseOpenTimePaste("213 14OCT").rows[0].frozen).toBeUndefined();
    expect(parseOpenTimePaste("TRIP\tDATE\tNOTE\n213\t14OCT\tCRS ONLY").rows[0].frozen).toBe(true);
  });

  it("survives anything", () => {
    for (const text of ["", "\n\n", "💥", "0".repeat(5000), "/".repeat(500), "213 ".repeat(1000)]) expect(() => parseOpenTimePaste(text)).not.toThrow();
  });
});

describe("the source seam", () => {
  it("a paste is one source of the snapshot everything else reads", async () => {
    const snapshot = await pasteSource("213 14OCT", () => 1000).read();
    expect(snapshot).toEqual(pasteSnapshot("213 14OCT", 1000));
    expect(snapshot.source).toBe("paste");
    expect(snapshot.readAt).toBe(1000);
  });
});
