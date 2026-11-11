import { describe, expect, it } from "vitest";
import { openingSteps, stepDepth, stepFromSearch, urlForStep } from "./interview-opening";

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
