import { describe, expect, it } from "vitest";
import { tripStops } from "@/components/results/RouteMap";

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
