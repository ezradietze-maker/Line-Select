import { describe, expect, it } from "vitest";
import { displayHotelName, isPlausibleMatch, readHotelName } from "@/lib/hotels/hotel-names";

// Every printed name below is verbatim from the October 2026 bid packs.
describe("reading the packs' hotel names", () => {
  it("spells out the house abbreviations and fixes the packs' typos for the search", () => {
    expect(readHotelName("DTREE S PARK").search).toBe("DOUBLETREE SOUTHPARK");
    expect(readHotelName("INTERCON DT").search).toBe("INTERCONTINENTAL DOWNTOWN");
    expect(readHotelName("MIS'N PALM HTL").search).toBe("MISSION PALMS HOTEL");
    expect(readHotelName("HOME2STES DOV").search).toBe("HOME2 SUITES DOV");
    expect(readHotelName("RI PDX AP").search).toBe("RESIDENCE INN PDX AIRPORT");
    expect(readHotelName("HYAT REGENCY").search).toBe("HYATT REGENCY");
    expect(readHotelName("F. AMERICANA").search).toBe("FIESTA AMERICANA");
    expect(readHotelName("915-351-2121/HILTON GRDN INN").search).toBe("HILTON GARDEN INN");
    expect(readHotelName("HYATT ETOILE +").search).toBe("HYATT ETOILE");
  });

  it("never looks up a hotel the pack hasn't assigned, and says so plainly", () => {
    expect(readHotelName("TBA").assigned).toBe(false);
    expect(displayHotelName("TBA")).toBe("hotel to be announced");
    expect(readHotelName("PROJECTED: ALOFT TOKYO GINZA")).toEqual({ search: "ALOFT TOKYO GINZA", assigned: true, projected: true });
    expect(displayHotelName("PROJECTED: HILTON")).toBe("HILTON (projected)");
  });

  it("rejects a match in another city, or a different property, and keeps the right one", () => {
    // What the old lookup showed, verbatim from the cache.
    expect(
      isPlausibleMatch("MEM", "EMBASSY SUITES", { name: "Embassy Suites by Hilton Atlanta Airport", location: { latitude: 33.636, longitude: -84.446 } })
    ).toBe(false);
    expect(isPlausibleMatch("TUL", "HYAT REGENCY", { name: "Hyatt Place Montreal Airport", location: { latitude: 45.47, longitude: -73.74 } })).toBe(false);
    expect(isPlausibleMatch("MHT", "DTREE DTWN", { name: "Super 8 by Wyndham Manchester Airport", location: { latitude: 42.93, longitude: -71.44 } })).toBe(
      false
    );
    expect(isPlausibleMatch("ORD", "INTERCON DT", { name: "Hilton Chicago O'Hare Airport", location: { latitude: 41.98, longitude: -87.9 } })).toBe(false);
    // Right hotel, even well away from the airport it serves.
    expect(isPlausibleMatch("NRT", "ALOFT TOKYO GINZA", { name: "Aloft by Marriott Tokyo Ginza", location: { latitude: 35.669, longitude: 139.765 } })).toBe(
      true
    );
    const burlingame = {
      name: "DoubleTree by Hilton Hotel San Francisco Airport",
      formattedAddress: "835 Airport Blvd., Burlingame, CA 94010, USA",
      location: { latitude: 37.59, longitude: -122.35 },
    };
    expect(isPlausibleMatch("SFO", "BURLINGAME D'TREE SFO AP", burlingame)).toBe(true);
    expect(
      isPlausibleMatch("HRL", "CY MARRIOTT", { name: "Courtyard by Marriott Harlingen", formattedAddress: "1725 W Filmore Avenue, Harlingen, TX 78550, USA" })
    ).toBe(true);
    // The brand and a street name aren't enough: the airport Hyatt Place on "Rue de la Belle Étoile" isn't the Hyatt Étoile.
    expect(
      isPlausibleMatch("CDG", "HYATT ETOILE +", {
        name: "Hyatt Place Paris Charles de Gaulle Airport",
        formattedAddress: "241 Rue de la Belle Étoile, 95700 Roissy-en-France, France",
      })
    ).toBe(false);
    // Nor is a sub-brand of the parent: a DoubleTree "by Hilton" isn't the Hilton.
    expect(
      isPlausibleMatch("SJC", "HILTON SJC/TWRS", { name: "DoubleTree by Hilton Hotel San Jose", formattedAddress: "2050 Gateway Pl, San Jose, CA 95110, USA" })
    ).toBe(false);
  });
});
