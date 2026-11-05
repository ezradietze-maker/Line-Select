import { describe, expect, it } from "vitest";
import { freezeShare, monthAt, monthsWords, scoreInMonth, seasonMonths, seasonOf } from "@/lib/seasons";

describe("seasons, from each city's weather", () => {
  it("puts the dead of winter where most nights freeze — Boston and Newark Dec–Feb, Anchorage Nov–Apr but not October", () => {
    expect(seasonMonths("BOS")?.winter).toEqual([1, 2, 12]);
    expect(seasonMonths("EWR")?.winter).toEqual([1, 2, 12]);
    expect(seasonMonths("ANC")?.winter).toEqual([1, 2, 3, 4, 11, 12]);
    expect(seasonOf("ANC", 10)).toBeNull();
    expect(seasonOf("MSP", 1)).toBe("winter");
  });

  it("gives mild cities no winter, and finds summer south of the equator and in desert heat", () => {
    expect(seasonMonths("HNL")?.winter).toEqual([]);
    expect(seasonMonths("SYD")?.winter).toEqual([]);
    expect(seasonMonths("SYD")?.summer).toEqual([1, 2, 12]);
    // Phoenix: its three warmest months; September's 101 °F is short of summer heat. Riyadh's 105 °F September isn't.
    expect(seasonMonths("PHX")?.summer).toEqual([6, 7, 8]);
    expect(seasonMonths("RUH")?.summer).toEqual([6, 7, 8, 9]);
    expect(seasonMonths("ANC")?.summer).toEqual([6, 7, 8]);
    expect(seasonMonths("ZZZ")).toBeNull();
  });

  it("grades a month: the pilot's own months first, then winter or summer, else the usual grade", () => {
    const anc = { winter: -0.5, summer: 1 };
    expect(scoreInMonth(0.5, anc, "ANC", 1)).toBe(-0.5);
    expect(scoreInMonth(0.5, anc, "ANC", 7)).toBe(1);
    expect(scoreInMonth(0.5, anc, "ANC", 10)).toBe(0.5);
    expect(scoreInMonth(0.5, anc, "ANC", null)).toBe(0.5);
    const hnl = { months: [{ months: [6, 7, 8], score: 0.5 }, { months: [12], score: 0 }] };
    expect(scoreInMonth(1, hnl, "HNL", 7)).toBe(0.5);
    expect(scoreInMonth(1, hnl, "HNL", 12)).toBe(0);
    expect(scoreInMonth(1, hnl, "HNL", 10)).toBe(1);
    expect(scoreInMonth(1, undefined, "HNL", 7)).toBe(1);
  });

  it("counts freezing nights as a share of the month", () => {
    expect(freezeShare("ANC", 1)).toBeGreaterThan(0.9);
    expect(freezeShare("MEM", 1)).toBeGreaterThan(0.3);
    expect(freezeShare("MEM", 1)).toBeLessThan(0.6);
    expect(freezeShare("HNL", 1)).toBe(0);
    expect(freezeShare("ZZZ", 1)).toBeNull();
  });

  it("puts a layover on its own month at the city, and an unplaced trip in the bid period's middle", () => {
    const trip = { startDayIndex: 27, schedule: [{ reportTimeLocal: "2000" }] } as never;
    // Report Jan 30 2027 at 20:00 in Memphis; 52 hours later it's Feb 1 in Anchorage.
    expect(monthAt({ bidPeriodStart: "2027-01-03", base: "MEM" }, trip, 0, "MEM")).toBe(1);
    expect(monthAt({ bidPeriodStart: "2027-01-03", base: "MEM" }, trip, 52 * 60, "ANC")).toBe(2);
    expect(monthAt({ bidPeriodStart: "2027-01-03", base: "MEM" }, { startDayIndex: null, schedule: [] } as never, 0, "ANC")).toBe(1);
    expect(monthAt({ bidPeriodStart: null, base: "MEM" }, trip, 0, "ANC")).toBeNull();
  });

  it("says months the way a pilot reads them, a run over the new year as one", () => {
    expect(monthsWords([12, 1, 2])).toBe("Dec–Feb");
    expect(monthsWords([6, 7, 8])).toBe("Jun–Aug");
    expect(monthsWords([1, 3])).toBe("Jan, Mar");
    expect(monthsWords([11, 12, 1, 2, 3, 4])).toBe("Nov–Apr");
    expect(monthsWords([])).toBe("");
  });
});
