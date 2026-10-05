import { describe, expect, it } from "vitest";
import { fibonacciPoint, LAND_POINT_COUNT, landPoints } from "@/lib/globe/land-mask";
import { GLOBE_ROUTES, globeRoutes, greatCircleNm, routeAirports } from "@/lib/globe/routes";

describe("land mask", () => {
  it("decodes to the land points it was generated with", () => {
    const land = landPoints();
    expect(land).toHaveLength(4604);
    // Roughly the share of Earth's surface that's land.
    expect(land.length / LAND_POINT_COUNT).toBeGreaterThan(0.25);
    expect(land.length / LAND_POINT_COUNT).toBeLessThan(0.33);
  });

  it("spreads points pole to pole", () => {
    expect(fibonacciPoint(0).lat).toBeGreaterThan(89);
    expect(fibonacciPoint(LAND_POINT_COUNT - 1).lat).toBeLessThan(-89);
  });
});

describe("globe routes", () => {
  it("gets real great-circle distances", () => {
    // MEM to CDG, about 3,950 nautical miles.
    expect(Math.round(greatCircleNm({ lat: 35.0424, lon: -89.9767 }, { lat: 49.0097, lon: 2.5479 }))).toBeGreaterThan(3900);
    expect(Math.round(greatCircleNm({ lat: 35.0424, lon: -89.9767 }, { lat: 49.0097, lon: 2.5479 }))).toBeLessThan(4000);
  });

  it("draws every listed route, since every airport has real coordinates", () => {
    expect(globeRoutes()).toHaveLength(GLOBE_ROUTES.length);
  });

  it("leaves out a route with an unknown airport instead of drawing it somewhere wrong", () => {
    expect(globeRoutes([["MEM", "ZZZ"], ["MEM", "CDG"]]).map((r) => r.to)).toEqual(["CDG"]);
  });

  it("lists each airport once", () => {
    const codes = routeAirports(globeRoutes()).map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("MEM");
  });
});
