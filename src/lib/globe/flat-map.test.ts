import { describe, expect, it } from "vitest";
import { greatCircle, isDaylight, nightPath, pathThrough, project, subsolarPoint } from "@/lib/globe/flat-map";

const MEM = { lat: 35.04, lon: -89.98 };
const HNL = { lat: 21.32, lon: -157.92 };
const NRT = { lat: 35.77, lon: 140.39 };

describe("the flat world map", () => {
  it("projects longitude across and latitude down", () => {
    expect(project({ lat: 0, lon: 0 })).toEqual([180, 90]);
    expect(project({ lat: 90, lon: -180 })).toEqual([0, 0]);
  });

  it("draws great circles the short way, lifting the pen at the date line", () => {
    const toHnl = greatCircle(MEM, HNL);
    expect(toHnl[0].lat).toBeCloseTo(MEM.lat, 5);
    expect(toHnl.at(-1)!.lon).toBeCloseTo(HNL.lon, 5);
    // Memphis to Tokyo bends north over Alaska, not along the parallel.
    expect(Math.max(...greatCircle(MEM, NRT).map((p) => p.lat))).toBeGreaterThan(55);
    // Honolulu to Tokyo crosses the date line: the path breaks there.
    expect((pathThrough(greatCircle(HNL, NRT)).match(/M/g) ?? []).length).toBe(2);
  });

  it("puts the sun over the right place and the night on the right side", () => {
    // Noon UTC at the June solstice: the sun near the Tropic of Cancer, over the prime meridian.
    const june = Date.UTC(2026, 5, 21, 12, 0);
    const s = subsolarPoint(june);
    expect(s.lat).toBeCloseTo(23.4, 0);
    expect(Math.abs(s.lon)).toBeLessThan(3);
    expect(isDaylight({ lat: 51.5, lon: 0 }, june)).toBe(true); // London at noon
    expect(isDaylight({ lat: 21.3, lon: -157.9 }, june)).toBe(false); // Honolulu at 2 AM
    expect(nightPath(june).startsWith("M0 180")).toBe(true); // dark pole in the south
  });
});
