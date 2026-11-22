import { describe, expect, it } from "vitest";
import { vacationHint } from "@/components/results/VacationLineControl";

describe("the Vacation drop-down's words, closed", () => {
  it("says where it is on the line, what it takes off, and whether it can slide", () => {
    expect(vacationHint(1, undefined, true)).toBe("where the pack has it · takes off 1 trip · slide it");
    expect(vacationHint(2, { offsets: { v: 4 } }, true)).toBe("slid 4 days later · takes off 2 trips · slide it");
    expect(vacationHint(0, { offsets: { v: -1 } }, false)).toBe("slid 1 day earlier · takes off no trips");
  });
});
