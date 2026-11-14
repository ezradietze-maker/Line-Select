import { describe, expect, it } from "vitest";
import { copiedSaying } from "@/components/results/BidOrderExport";

describe("what Copy shortlist says it copied", () => {
  it("names the starred lines it left out for being in Not bid", () => {
    expect(copiedSaying("shortlist", 280, 2, 3, 1)).toBe("Shortlist copied: 2 lines, 1 in Not bid left out");
    expect(copiedSaying("shortlist", 280, 3, 3, 0)).toBe("Shortlist copied: 3 lines");
  });
});
