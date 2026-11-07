import { describe, expect, it } from "vitest";
import { hotelPosition, rangeRingMiles } from "./hotel-position";

describe("hotelPosition", () => {
  it("measures a hotel due north of the field", () => {
    const p = hotelPosition([35.0, -90.0], { latitude: 35.1, longitude: -90.0 });
    expect(p.miles).toBeCloseTo(6.91, 1);
    expect(p.bearing).toBeCloseTo(0, 0);
    expect(p.direction).toBe("north");
  });

  it("names the compass point for a hotel to the west-northwest", () => {
    const p = hotelPosition([37.72, -122.22], { latitude: 37.84, longitude: -122.29 });
    expect(p.direction).toBe("northwest");
    expect(p.miles).toBeGreaterThan(8);
    expect(p.miles).toBeLessThan(10);
  });
});

describe("rangeRingMiles", () => {
  it("picks the first ring with room to spare", () => {
    expect(rangeRingMiles(1)).toBe(2);
    expect(rangeRingMiles(4.5)).toBe(10);
    expect(rangeRingMiles(9)).toBe(20);
    expect(rangeRingMiles(100)).toBe(150);
  });
});
