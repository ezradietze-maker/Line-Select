import { describe, expect, it } from "vitest";
import { aimLabel, cleanAims, GOAL_EXAMPLES, readGoalText, toEngineGoal, withDeviceReading } from "@/lib/vacation-goal";
import type { BidPack, Line } from "@/types/bidpack";

// October 2026: the bid month runs Sep 28 to Oct 25; trips lay over in Honolulu and Guangzhou.
const lines = [{ trips: [{ layoverCities: ["HNL", "OAK"] }, { layoverCities: ["CAN"] }] }] as unknown as Line[];
const pack = { bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines } as Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "lines">;
const kinds = (t: string) => readGoalText(t, pack).aims.map((a) => a.kind);

describe("reading what a pilot wants from their vacation, on the device", () => {
  it("reads every example under the box, with nothing left over for the model", () => {
    for (const ex of GOAL_EXAMPLES) {
      const r = readGoalText(ex, pack);
      expect(r.aims.length, ex).toBeGreaterThan(0);
      expect(r.unread, ex).toEqual([]);
    }
    expect(kinds("Max out my credit")).toEqual(["credit"]);
    expect(kinds("Longest stretch at home")).toEqual(["stretch"]);
    expect(kinds("Weekends off")).toEqual(["weekends"]);
    expect(kinds("Keep my bank")).toEqual(["keep-bank"]);
    // Working more is flying more: the vacation should cover the least, never "most credit", which covers the most.
    for (const t of ["I want to work as much as possible", "fly as much as I can", "work the most", "as little off as possible"]) expect(kinds(t), t).toEqual(["keep-bank"]);
    expect(kinds("Leave it where it is")).toEqual(["as-awarded"]);
  });

  it("reads the usual ways of saying it", () => {
    expect(kinds("I want the most pay possible")).toEqual(["credit"]);
    expect(kinds("cover the biggest trips")).toEqual(["credit"]);
    expect(kinds("as many days off as I can, then weekends")).toEqual(["days-off", "weekends"]);
    expect(kinds("most days in a row")).toEqual(["stretch"]);
  });

  it("reads dates, ranges and holidays onto the bid month's days, and puts them first", () => {
    const r = readGoalText("most credit but keep Oct 24 off", pack);
    expect(r.aims).toEqual([{ kind: "dates", dates: ["2026-10-24"] }, { kind: "credit" }]);
    // All of it read on the device: nothing for the model.
    expect(r.unread).toEqual([]);
    expect(readGoalText("off oct 20-22", pack).aims[0]).toEqual({ kind: "dates", dates: ["2026-10-20", "2026-10-21", "2026-10-22"] });
    expect(readGoalText("home for Halloween", pack).aims[0]).toEqual({ kind: "dates", dates: ["2026-10-31"] });
    expect(readGoalText("the 3rd off", pack).aims[0]).toEqual({ kind: "dates", dates: ["2026-10-03"] });
  });

  it("reads cities by name or code, kept or taken, only ones the pack lays over in", () => {
    expect(readGoalText("keep my Honolulu trips", pack).aims).toEqual([{ kind: "keep", cities: ["HNL"] }]);
    expect(readGoalText("get rid of the CAN trip", pack).aims).toEqual([{ kind: "drop", cities: ["CAN"] }]);
    expect(readGoalText("keep my Paris trips", pack).aims).toEqual([]);
  });

  it("leaves what it can't read for the model", () => {
    const r = readGoalText("I'd like my kid's recital covered", pack);
    expect(r.unread.length).toBeGreaterThan(0);
  });

  it("puts the aims on this pack's days, and says them back plainly", () => {
    expect(toEngineGoal([{ kind: "dates", dates: ["2026-10-24"] }, { kind: "credit" }], pack).aims).toEqual([{ kind: "dates", days: [26] }, { kind: "credit" }]);
    expect(aimLabel({ kind: "keep", cities: ["HNL"] })).toBe("Keep your Honolulu trips");
    expect(aimLabel({ kind: "dates", dates: ["2026-10-24", "2026-10-25"] })).toBe("Off Oct 24, Oct 25");
  });
});

describe("a model's answer, checked", () => {
  it("keeps a date or city the device read even if the model let it go", () => {
    expect(withDeviceReading([{ kind: "credit" }], [{ kind: "dates", dates: ["2026-10-24"] }, { kind: "credit" }])).toEqual([{ kind: "dates", dates: ["2026-10-24"] }, { kind: "credit" }]);
    expect(withDeviceReading([{ kind: "dates", dates: ["2026-10-22"] }], [{ kind: "dates", dates: ["2026-10-24"] }])).toEqual([{ kind: "dates", dates: ["2026-10-22"] }]);
  });

  it("keeps known kinds, real dates and the pack's own cities; drops the rest", () => {
    const raw = [
      { kind: "credit", dates: [], cities: [] },
      { kind: "dates", dates: ["2026-10-24", "soon"], cities: [] },
      { kind: "keep", dates: [], cities: ["hnl", "CDG"] },
      { kind: "teleport", dates: [], cities: [] },
      { kind: "credit", dates: [], cities: [] },
    ];
    expect(cleanAims(raw, pack)).toEqual([{ kind: "credit" }, { kind: "dates", dates: ["2026-10-24"] }, { kind: "keep", cities: ["HNL"] }]);
    expect(cleanAims("nope", pack)).toEqual([]);
  });
});
