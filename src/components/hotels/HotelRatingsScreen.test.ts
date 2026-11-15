import { describe, expect, it } from "vitest";
import { groupByHotel, hotelLookupNote } from "@/components/hotels/HotelRatingsScreen";
import type { BidPack } from "@/types/bidpack";

const line = (lineNumber: string, layovers: { city: string; hotelName: string | null }[]) => ({ lineNumber, trips: [{ layoverDetails: layovers }] });
const pack = (lines: ReturnType<typeof line>[]) => ({ lines }) as unknown as BidPack;

describe("Hotel Ratings", () => {
  it("lists only hotels the pack has assigned, not one to be announced", () => {
    const groups = groupByHotel(
      pack([
        line("1", [{ city: "ANC", hotelName: "HILTON ANC" }, { city: "NRT", hotelName: "TBA" }]),
        line("2", [{ city: "NRT", hotelName: "TBA" }, { city: "CDG", hotelName: null }]),
      ])
    );
    expect(groups.map((g) => g.key)).toEqual(["ANC|HILTON ANC"]);
  });

  it("says a lookup that failed for now failed, not that Google has no match", () => {
    expect(hotelLookupNote(null, true)).toMatch(/Couldn’t look this hotel up just now/);
    expect(hotelLookupNote(null, false)).toBe("No Google Places match found for this hotel.");
    expect(hotelLookupNote(undefined, false)).toBe("Looking up…");
  });
});
