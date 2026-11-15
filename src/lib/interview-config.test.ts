import { describe, expect, it } from "vitest";
import { formatHoursValue } from "@/lib/interview-config";

describe("formatHoursValue", () => {
  it("reads hours as the pack prints them, rounded to the minute", () => {
    expect(formatHoursValue(18.9333)).toBe("18:56");
    expect(formatHoursValue(7.995)).toBe("8:00");
    expect(formatHoursValue(0)).toBe("0:00");
  });

  // Round 25: -0.5 read "-1:-30", a floor of the hours and a signed remainder of the minutes.
  it("writes a negative once, in front", () => {
    expect(formatHoursValue(-0.5)).toBe("-0:30");
    expect(formatHoursValue(-2.25)).toBe("-2:15");
    expect(formatHoursValue(-7.995)).toBe("-8:00");
    // Under half a minute either side is no time at all, not "-0:00".
    expect(formatHoursValue(-0.001)).toBe("0:00");
  });
});
