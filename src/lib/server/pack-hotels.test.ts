import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => store.get(key) ?? null,
  setJson: async (key: string, value: unknown) => void store.set(key, value),
}));

const { hotelsInPack, isPackHotel, rememberPackHotels } = await import("./pack-hotels");

const pack = {
  lines: [
    {
      trips: [
        {
          layoverDetails: [{ city: "ANC", hotelName: "Hilton Anchorage" }, { city: "HNL", hotelName: null }],
          dutyPeriods: [
            {
              legs: [{ arrAirport: "SDF", dayRoomHotel: "Hyatt Louisville" }, { arrAirport: "MEM" }],
              layover: { city: "ANC", hotelName: "Hilton Anchorage", variants: [{ hotelName: "Marriott Anchorage" }] },
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => store.clear());

describe("hotels a pack names", () => {
  it("finds layover hotels, their dated variants and day rooms, once each", () => {
    expect(hotelsInPack(pack).map((h) => `${h.code} ${h.hotelName}`).sort()).toEqual(["ANC Hilton Anchorage", "ANC Marriott Anchorage", "SDF Hyatt Louisville"]);
  });

  it("lets a guest look up only those", async () => {
    await rememberPackHotels(pack);
    expect(await isPackHotel("ANC", "Hilton Anchorage")).toBe(true);
    expect(await isPackHotel("anc", "hilton anchorage")).toBe(true);
    expect(await isPackHotel("ANC", "Made Up Inn 123")).toBe(false);
    expect(await isPackHotel("LAX", "Hilton Anchorage")).toBe(false);
  });
});
