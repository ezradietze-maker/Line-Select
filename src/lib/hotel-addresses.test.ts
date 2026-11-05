import { describe, expect, it } from "vitest";
import { hotelAddress, hotelInPlaces, rememberHotelAddress } from "@/lib/hotel-addresses";

describe("hotels in the places a pilot names", () => {
  it("matches a place's whole words in the printed name, case and punctuation aside", () => {
    expect(hotelInPlaces("OAK", "MARRIOTT PLEASANTON", ["Pleasanton", "Dublin", "San Ramon"])).toBe(true);
    expect(hotelInPlaces("OAK", "SONESTA OAKLAND EMERYVILLE", ["Pleasanton", "Dublin", "San Ramon"])).toBe(false);
    expect(hotelInPlaces("OAK", "SAN RAMON MARRIOTT", ["san ramon"])).toBe(true);
    // A word inside another isn't the place.
    expect(hotelInPlaces("OAK", "DUBLINER INN", ["Dublin"])).toBe(false);
  });

  it("matches the address once the hotel has been looked up", () => {
    expect(hotelInPlaces("EWR", "SHERATON LINCOLN HBR", ["Manhattan"])).toBe(false);
    rememberHotelAddress("EWR", "SHERATON LINCOLN HBR", "500 Harbor Blvd, Weehawken, NJ 07086, USA");
    expect(hotelAddress("ewr", "sheraton lincoln hbr")).toContain("Weehawken");
    expect(hotelInPlaces("EWR", "SHERATON LINCOLN HBR", ["Weehawken"])).toBe(true);
    expect(hotelInPlaces("EWR", "SHERATON LINCOLN HBR", ["New York, NY"])).toBe(false);
    rememberHotelAddress("EWR", "HILTON MIDTOWN", "1335 6th Ave, New York, NY 10019, USA");
    expect(hotelInPlaces("EWR", "HILTON MIDTOWN", ["New York, NY"])).toBe(true);
  });
});
