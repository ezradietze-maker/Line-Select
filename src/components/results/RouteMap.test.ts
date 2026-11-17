import { describe, expect, it } from "vitest";
import { type CityLabel, placeLabels, routeChart, tripStops } from "@/components/results/RouteMap";
import type { Line } from "@/types/bidpack";

describe("a trip's stops on the route map", () => {
  it("keeps the order it flies, a city visited twice included", () => {
    // Trip 303: MEM → LAX → IND → LAX → (deadhead home). Listed once each, it read as flying home from IND.
    const trip = { layoverCities: ["LAX", "IND"], layoverDetails: [{ city: "LAX", hotelName: "H1" }, { city: "IND", hotelName: "H2" }, { city: "LAX", hotelName: "H3" }] };
    expect(tripStops(trip)).toEqual(["LAX", "IND", "LAX"]);
  });

  it("counts a city once when it lays over there two nights running", () => {
    const trip = { layoverCities: ["CDG"], layoverDetails: [{ city: "CDG", hotelName: "H" }, { city: "CDG", hotelName: "H" }] };
    expect(tripStops(trip)).toEqual(["CDG"]);
  });

  it("falls back to the city list for a trip without layover details", () => {
    expect(tripStops({ layoverCities: ["ANC", "NRT"], layoverDetails: [] })).toEqual(["ANC", "NRT"]);
  });
});

describe("city tags on the route map", () => {
  const trip = (cities: string[]) => ({ layoverCities: cities, layoverDetails: [] }) as unknown as Line["trips"][number];
  // B777 MEM FO line 2295: trips 2031 (ANC HKG IST FRA) and 128 (ATL ICN HAN ANC). Every tag sat above its dot, so
  // ATL's covered MEM's and HAN's covered HKG's.
  const line = { trips: [trip(["ANC", "HKG", "IST", "FRA"]), trip(["ATL", "ICN", "HAN", "ANC"])] };
  type Box = { code: string; left: number; top: number; right: number; bottom: number };
  const boxOf = (l: CityLabel): Box => ({ code: l.code, left: l.left, top: l.top, right: l.left + l.width, bottom: l.top + 16 });
  const hits = (a: Box, b: Box) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

  for (const width of [340, 560]) {
    it(`every city can be read, ${width} wide`, () => {
      const { labels, bounds } = routeChart("MEM", line, width)!;
      expect(labels.map((l) => l.code).sort()).toEqual(["ANC", "ATL", "FRA", "HAN", "HKG", "ICN", "IST", "MEM"]);
      const boxes = labels.map(boxOf);
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) expect(hits(a, b), `${a.code} tag over ${b.code} tag`).toBe(false);
        // No tag over another city's dot, and none past the frame's edge.
        for (const d of labels) if (d.code !== a.code) expect(hits(a, { code: d.code, left: d.x - 4, top: d.y - 4, right: d.x + 4, bottom: d.y + 4 }), `${a.code} tag over ${d.code} dot`).toBe(false);
        expect(a.left >= 0 && a.top >= 0 && a.right <= bounds.width && a.bottom <= bounds.height, `${a.code} inside the frame`).toBe(true);
      }
    });
  }

  it("keeps a lone city's tag straight above its dot", () => {
    const [mem, lax] = placeLabels([{ code: "MEM", x: 400, y: 100 }, { code: "LAX", x: 100, y: 120 }], 560, 200, "MEM");
    expect([mem.left + mem.width / 2, mem.top, mem.leader]).toEqual([400, 74, false]);
    expect([lax.left + lax.width / 2, lax.top, lax.leader]).toEqual([100, 94, false]);
  });
});
