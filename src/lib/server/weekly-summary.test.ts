import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/learning-store", () => ({}));
const { notesLines, weeklyText } = await import("./weekly-summary");

describe("the Monday section", () => {
  it("says, group by group, whether notes are on and why", () => {
    const model = {
      version: "b",
      createdAt: "",
      interviews: 30,
      levels: {
        all: { pilots: 30, metrics: {}, review: {}, cities: {}, notes: { on: true, reason: "80% of the notes held for the newest 6 pilots", lines: ["common|a", "cities|b"] } },
        "pack:MEM|MD11|CAP|commuter": { pilots: 4, metrics: {}, review: {}, cities: {}, notes: { on: false, reason: "4 pilots so far — needs 10", lines: [] } },
      },
    };
    expect(notesLines(model)).toEqual([
      "Whole fleet (30 pilots): notes ON — 80% of the notes held for the newest 6 pilots; 2 lines",
      "MEM MD11 CAP, commuter (4 pilots): notes off — 4 pilots so far — needs 10",
    ]);
    expect(notesLines(null)).toEqual(["No fleet learning yet."]);
  });

  it("puts the week together, naming anything switched off", () => {
    const text = weeklyText({ notes: ["n"], scores: ["s"], runs: [], switchedOff: ["brain"] });
    expect(text).toMatch(/THIS WEEK — WHAT THE BRAIN LEARNED/);
    expect(text).toMatch(/Learning runs this week:\n {2}- none/);
    expect(text).toMatch(/Switched off by you: brain/);
  });
});
