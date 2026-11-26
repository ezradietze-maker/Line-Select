import { describe, expect, it } from "vitest";
import { aimLabel, cleanAims, GOAL_EXAMPLES, guessVacationGoal, PAY_CHOICES, readGoalText, toEngineGoal, withDeviceReading } from "@/lib/vacation-goal";
import type { Criterion, PilotModel } from "@/types/pilot-model";
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

describe("pay, which means one of two opposite things", () => {
  it("asks which kind when the pilot only says pay or money", () => {
    for (const t of ["I want the most pay possible", "max money", "get paid", "pay max", "more money"]) expect(kinds(t), t).toEqual(["pay"]);
    // Read on the device, so the question comes at once.
    expect(readGoalText("I want the most pay possible", pack).unread).toEqual([]);
    expect(aimLabel({ kind: "pay" })).toBe("Which kind of pay?");
  });

  it("reads paid time off as the biggest trips under the vacation, not as days off", () => {
    for (const t of ["Paid time off", "knock out the most flying", "get paid not to fly", "Max out my credit"]) expect(kinds(t), t).toEqual(["credit"]);
  });

  it("reads the most money overall as keeping the flying and the bank", () => {
    for (const t of ["Most money overall", "get paid for both", "save it for the buyback", "deconflict it"]) expect(kinds(t), t).toEqual(["keep-bank"]);
  });

  it("slides by nothing until it's answered, and offers exactly the two kinds", () => {
    expect(toEngineGoal([{ kind: "pay" }, { kind: "weekends" }], pack).aims).toEqual([{ kind: "weekends" }]);
    expect(PAY_CHOICES.map((c) => [c.kind, c.title])).toEqual([
      ["credit", "Paid time off"],
      ["keep-bank", "Most money overall"],
    ]);
    expect(cleanAims([{ kind: "pay" }], pack)).toEqual([{ kind: "pay" }]);
  });
});

describe("the vacation goal guessed from the interview", () => {
  const c = (metric: string, shape: Criterion["shape"], weight: number, params?: Criterion["params"]) => ({ id: metric, metric, shape, weight, params }) as Criterion;
  const model = (criteria: Criterion[]) => ({ criteria }) as Pick<PilotModel, "criteria">;

  it("follows the pilot's own priorities, most weighted first, up to three", () => {
    const m = model([c("weekendDaysOff", { kind: "more" }, 0.3), c("bodyClockScore", { kind: "more" }, 0.9), c("longestDaysOffBlock", { kind: "more" }, 0.6), c("homeDepartures", { kind: "less" }, 0.5), c("daysOff", { kind: "more" }, 0.2)]);
    expect(guessVacationGoal(m)).toEqual([{ kind: "stretch" }, { kind: "days-off" }, { kind: "weekends" }]);
  });

  it("reads credit wanted as the most money overall, and less credit as time off", () => {
    expect(guessVacationGoal(model([c("creditHours", { kind: "more" }, 0.8)]))).toEqual([{ kind: "keep-bank" }]);
    expect(guessVacationGoal(model([c("creditHours", { kind: "less" }, 0.8)]))).toEqual([{ kind: "days-off" }]);
  });

  it("keeps the dates the pilot must have off", () => {
    expect(guessVacationGoal(model([c("requestedDatesWorked", { kind: "less" }, 1, { dates: ["2026-10-24"] }), c("daysOff", { kind: "more" }, 0.5)]))).toEqual([
      { kind: "dates", dates: ["2026-10-24"] },
      { kind: "days-off" },
    ]);
  });

  it("with nothing to go on, the most days off: extra time off with pay, what most pilots want", () => {
    expect(guessVacationGoal(undefined)).toEqual([{ kind: "days-off" }]);
    expect(guessVacationGoal(model([c("bodyClockScore", { kind: "more" }, 1), c("daysOff", { kind: "more" }, 0)]))).toEqual([{ kind: "days-off" }]);
  });
});
