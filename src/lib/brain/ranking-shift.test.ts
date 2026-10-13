import { describe, expect, it } from "vitest";
import { topShift } from "./ranking-shift";

describe("topShift", () => {
  it("counts the lines that dropped out of the top, not reorderings within it", () => {
    expect(topShift(["1", "2", "3"], ["3", "2", "1"])).toBe(0);
    expect(topShift(["1", "2", "3"], ["1", "2", "9"])).toBe(1);
    expect(topShift(["1", "2", "3"], ["7", "8", "9"])).toBe(3);
  });
});
