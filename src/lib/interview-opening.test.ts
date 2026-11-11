import { describe, expect, it } from "vitest";
import { openingSteps, popMove, stateForEntry, stepDepth, stepEntryOf, stepFromSearch, stepsBetween, urlForStep } from "./interview-opening";

describe("the interview's opening steps in the address", () => {
  const full = openingSteps(false, true);

  it("runs seniority, story, commute, cities; a check-in skips the story and commute", () => {
    expect(full).toEqual(["seniority", "story", "commuter", "cities"]);
    expect(openingSteps(false, false)).toEqual(["story", "commuter", "cities"]);
    expect(openingSteps(true, false)).toEqual(["checkin", "cities"]);
  });

  it("puts every step but the first in the address, keeping anything else there", () => {
    expect(urlForStep("/interview", "", "seniority", full)).toBe("/interview");
    expect(urlForStep("/interview", "", "commuter", full)).toBe("/interview?step=commuter");
    expect(urlForStep("/interview", "?step=commuter&x=1", "story", full)).toBe("/interview?step=story&x=1");
    expect(urlForStep("/interview", "?step=commuter", "seniority", full)).toBe("/interview");
  });

  it("reads the step back, on Back as on arrival", () => {
    expect(stepFromSearch("?step=cities", full)).toBe("cities");
    expect(stepFromSearch("", full)).toBe("seniority");
    // A step this interview doesn't have (a check-in's address, in the full interview) is its first step.
    expect(stepFromSearch("?step=checkin", full)).toBe("seniority");
    expect(stepFromSearch("?step=story", openingSteps(true, true))).toBe("seniority");
  });

  it("counts the entries Back can take before it leaves the interview", () => {
    expect(stepDepth("seniority", full)).toBe(0);
    expect(stepDepth("cities", full)).toBe(3);
    expect(stepDepth("cities", openingSteps(false, false))).toBe(2);
  });
});

describe("the interview's own history entries", () => {
  const full = openingSteps(false, true);

  it("reads back what it wrote, alongside the router's own state, and nothing else", () => {
    const entry = { visit: "v2", step: "story" as const, at: 4 };
    expect(stepEntryOf({ __NA: true, ...stateForEntry(entry) })).toEqual(entry);
    expect(stepEntryOf(null)).toBeNull();
    expect(stepEntryOf({ __NA: true })).toBeNull();
    expect(stepEntryOf({ lineSelectInterview: { visit: "v1" } })).toBeNull();
  });

  // A reload on ?step=story: the earlier visit's first, commute and story entries sat at 0, 1 and 2, and the story
  // entry became this visit's first step.
  it("after a reload, Back from the first step steps over the earlier visit's entries rather than onto a later step", () => {
    const earlierCommute = { visit: "v1", step: "commuter" as const, at: 1 };
    expect(popMove(earlierCommute, "v2", 2, 3)).toEqual({ kind: "go", by: -1 });
    expect(popMove({ ...earlierCommute, step: "seniority", at: 0 }, "v2", 2, 3)).toEqual({ kind: "go", by: -1 });
  });

  it("shows this visit's own steps, and reads an unmarked entry's address as before", () => {
    expect(popMove({ visit: "v2", step: "commuter", at: 3 }, "v2", 4, 5)).toEqual({ kind: "show", step: "commuter" });
    expect(popMove(null, "v2", 4, 5)).toEqual({ kind: "address" });
  });

  it("going forward over an earlier visit's entries, goes on past them, or back to its own when they're the last", () => {
    expect(popMove({ visit: "v1", step: "commuter", at: 3 }, "v3", 2, 5)).toEqual({ kind: "go", by: 1 });
    expect(popMove({ visit: "v1", step: "story", at: 4 }, "v3", 2, 5)).toEqual({ kind: "go", by: -2 });
  });

  it("resumes by pushing only the steps past the one the pilot is on, or stepping back to it", () => {
    // On the first step: one entry for each step up to theirs.
    expect(stepsBetween(0, "commuter", full)).toEqual({ push: ["story", "commuter"], back: 0 });
    // Already stepped on to the story: only the commute is new.
    expect(stepsBetween(1, "commuter", full)).toEqual({ push: ["commuter"], back: 0 });
    // Already past theirs: back over this visit's own entries, none pushed.
    expect(stepsBetween(3, "story", full)).toEqual({ push: [], back: 2 });
    expect(stepsBetween(2, "commuter", full)).toEqual({ push: [], back: 0 });
  });
});
