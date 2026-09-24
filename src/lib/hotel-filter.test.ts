import { describe, expect, it } from "vitest";
import { hotelFilterHref, lineHasHotel, parseHotelFilter } from "@/lib/hotel-filter";
import type { Line } from "@/types/bidpack";

function lineWithLayovers(layovers: { city: string; hotelName: string | null }[]): Line {
  return { trips: [{ layoverDetails: layovers }] } as unknown as Line;
}

describe("lineHasHotel", () => {
  const filter = { city: "CDG", hotelName: "WHITE SWAN" };

  it("finds a line that stays at the hotel", () => {
    expect(lineHasHotel(lineWithLayovers([{ city: "CDG", hotelName: "WHITE SWAN" }]), filter)).toBe(true);
  });

  it("does not match the same hotel name in a different city, or a different hotel in the same city", () => {
    expect(lineHasHotel(lineWithLayovers([{ city: "ANC", hotelName: "WHITE SWAN" }]), filter)).toBe(false);
    expect(lineHasHotel(lineWithLayovers([{ city: "CDG", hotelName: "OTHER" }]), filter)).toBe(false);
    expect(lineHasHotel(lineWithLayovers([{ city: "CDG", hotelName: null }]), filter)).toBe(false);
  });
});

describe("hotel filter links", () => {
  it("round-trips a hotel name with spaces and punctuation", () => {
    const filter = { city: "ICN", hotelName: "L'HOTEL & SPA #2" };
    const url = new URL(hotelFilterHref(filter), "https://example.com");
    expect(url.pathname).toBe("/results");
    expect(parseHotelFilter(url.searchParams)).toEqual(filter);
  });

  it("returns null unless both parts are present", () => {
    expect(parseHotelFilter(new URLSearchParams("hotel=X"))).toBeNull();
    expect(parseHotelFilter(new URLSearchParams("hotelCity=ICN"))).toBeNull();
    expect(parseHotelFilter(new URLSearchParams(""))).toBeNull();
  });
});
