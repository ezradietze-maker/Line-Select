import { describe, expect, it } from "vitest";
import { formatHoursValue } from "@/lib/interview-config";
import { LINES, MONTH } from "./StoryVisuals";

// "Real lines from that pack": the October 2026 B767 MEM pack, as its line grid prints them.
describe("landing page story panels", () => {
  it("shows each line's credit to the minute the pack prints", () => {
    const shown = Object.fromEntries(LINES.map((l) => [l.n, formatHoursValue(l.credit)]));
    expect(shown).toEqual({ "2016": "73:45", "2024": "77:28", "2033": "79:53", "2035": "78:06", "2164": "81:52" });
  });

  it("puts line 2033's layover cities on the days the pack does", () => {
    // Sep 28 – Oct 25. Pairing 79 runs Oct 11–23: CDG, then DUB, MXP, four days in BLL, MXP, two in BLL, CDG.
    const byDate = Object.fromEntries(MONTH.map((c, i) => [new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(5, 10), c]).filter(([, c]) => c !== null));
    expect(byDate).toEqual({
      "10-11": "CDG", "10-12": "CDG", "10-13": "DUB", "10-14": "DUB", "10-15": "MXP", "10-16": "BLL", "10-17": "BLL",
      "10-18": "BLL", "10-19": "BLL", "10-20": "MXP", "10-21": "BLL", "10-22": "CDG", "10-23": "CDG",
    });
    expect(MONTH).toHaveLength(28);
    expect(MONTH.filter((c) => c === null)).toHaveLength(15);
  });
});
