import { describe, expect, it } from "vitest";
import { dateLineCrossing } from "./date-line";

describe("dateLineCrossing", () => {
  it("finds a flight across the Pacific, and which way", () => {
    expect(dateLineCrossing("PVG", "MEM")).toBe("east");
    expect(dateLineCrossing("NRT", "ANC")).toBe("east");
    expect(dateLineCrossing("ANC", "ICN")).toBe("west");
  });

  it("leaves alone a long flight that only crosses time zones, and one with an unknown airport", () => {
    expect(dateLineCrossing("CDG", "MEM")).toBeNull();
    expect(dateLineCrossing("MEM", "HNL")).toBeNull();
    expect(dateLineCrossing("ZZZ", "ANC")).toBeNull();
  });
});
