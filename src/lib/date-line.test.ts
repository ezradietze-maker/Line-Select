import { describe, expect, it } from "vitest";
import { dateLineCrossing, dateLineFraction, dateLinePass } from "./date-line";

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

describe("dateLinePass", () => {
  it("jumps the local clock 17 hours forward Anchorage to Seoul in October, and back the other way", () => {
    const west = dateLinePass("ANC", "ICN", "2026-10-12T18:00:00.000Z", "2026-10-13T01:00:00.000Z")!;
    expect(west.direction).toBe("west");
    expect(west.jumpMinutes).toBe(17 * 60);
    const east = dateLinePass("ICN", "ANC", "2026-10-12T12:55:00.000Z", "2026-10-12T21:00:00.000Z")!;
    expect(east.jumpMinutes).toBe(-17 * 60);
  });

  it("crosses 180° partway along the flight, somewhere over the Pacific", () => {
    const pass = dateLinePass("ANC", "ICN", "2026-10-12T18:00:00.000Z", "2026-10-13T01:00:00.000Z")!;
    const at = Date.parse(pass.crossesAt);
    expect(at).toBeGreaterThan(Date.parse("2026-10-12T18:00:00.000Z"));
    expect(at).toBeLessThan(Date.parse("2026-10-13T01:00:00.000Z"));
    expect(dateLineFraction("ANC", "ICN")).toBeGreaterThan(0.1);
    expect(dateLineFraction("ANC", "ICN")).toBeLessThan(0.6);
  });

  it("follows the clocks through daylight saving: 18 hours once Anchorage is back on standard time", () => {
    expect(dateLinePass("ANC", "ICN", "2026-11-12T19:00:00.000Z", "2026-11-13T02:00:00.000Z")!.jumpMinutes).toBe(18 * 60);
  });

  it("is nothing for a flight that doesn't cross the line", () => {
    expect(dateLinePass("CDG", "MEM", "2026-10-12T18:00:00.000Z", "2026-10-13T03:00:00.000Z")).toBeNull();
  });
});
