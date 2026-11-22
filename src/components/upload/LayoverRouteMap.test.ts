import { describe, expect, it } from "vitest";
import { frameAround, labelBox, labelSides } from "@/components/upload/LayoverRouteMap";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { project } from "@/lib/globe/flat-map";

const at = (code: string) => {
  const [lat, lon] = coordinatesForAirport(code)!;
  const [x, y] = project({ lat, lon });
  return { code, x, y };
};

/** The most-flown three from `base` named on a map `width` px wide at `rem` px to the rem: each one's box. */
function boxes(base: string, codes: string[], width: number, rem: number) {
  const stops = codes.map(at);
  const view = frameAround([at(base), ...stops]);
  const sides = labelSides(stops, view, width, rem);
  return stops.map((s, i) => labelBox(sides[i], ((s.x - view[0]) / view[2]) * width, ((s.y - view[1]) / view[3]) * (width / 3), s.code.length, rem));
}
const overlap = (a: ReturnType<typeof labelBox>, b: ReturnType<typeof labelBox>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

describe("the upload screen's route map names its most-flown three clear of one another", () => {
  it("three close together (MDT, IND and BWI from Memphis) no longer print over each other", () => {
    for (const [width, rem] of [[301, 16], [265, 24], [210, 24], [176, 32]]) {
      const b = boxes("MEM", ["MDT", "IND", "BWI"], width, rem);
      expect([overlap(b[0], b[1]), overlap(b[0], b[2]), overlap(b[1], b[2])], `${width}px at ${rem}px`).toEqual([false, false, false]);
    }
  });

  it("with the text set larger, IND and LAX from Memphis take sides apart", () => {
    const b = boxes("MEM", ["IND", "MIA", "LAX"], 265, 24);
    expect(overlap(b[0], b[2])).toBe(false);
  });

  it("keeps the sides it always had where they're clear, and before the map is measured", () => {
    const stops = ["YYZ", "EWR", "HNL"].map(at);
    const view = frameAround([at("MEM"), ...stops]);
    expect(labelSides(stops, view, 301, 16)).toEqual(["west", "east", "above"]);
    const close = ["MDT", "IND", "BWI"].map(at);
    expect(labelSides(close, frameAround([at("MEM"), ...close]), 0, 16)).toEqual(["east", "west", "east"]);
  });
});
