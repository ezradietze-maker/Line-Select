import { describe, expect, it } from "vitest";
import { initialSeat, shouldWarnAboutEstimatedLines } from "@/lib/seat-choice";

describe("initialSeat", () => {
  it("picks the only seat when the pack has just one", () => {
    expect(initialSeat(["FO"], null)).toBe("FO");
    expect(initialSeat(["CAP"], "FO")).toBe("CAP");
  });

  it("never defaults to the first seat when both are present and nothing is known", () => {
    expect(initialSeat(["CAP", "FO"], null)).toBeUndefined();
  });

  it("reuses the seat from the pilot's current bid pack when both are present", () => {
    expect(initialSeat(["CAP", "FO"], "FO")).toBe("FO");
    expect(initialSeat(["CAP", "FO"], "CAP")).toBe("CAP");
  });
});

describe("shouldWarnAboutEstimatedLines", () => {
  it("stays quiet for a handful of estimated lines", () => {
    expect(shouldWarnAboutEstimatedLines(2, 283)).toBe(false);
  });

  it("warns once 5% or more of the lines are estimated", () => {
    expect(shouldWarnAboutEstimatedLines(47, 283)).toBe(true);
    expect(shouldWarnAboutEstimatedLines(15, 300)).toBe(true);
  });

  it("handles an empty pack", () => {
    expect(shouldWarnAboutEstimatedLines(0, 0)).toBe(false);
  });
});
