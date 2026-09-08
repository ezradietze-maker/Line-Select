import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAmenitySummary } from "./route";

describe("fetchAmenitySummary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes a single searchNearby call covering every amenity category's types", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAmenitySummary({ latitude: 1, longitude: 2 }, "key");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.includedTypes.sort()).toEqual(
      ["restaurant", "gym", "grocery_store", "supermarket", "pharmacy", "cafe"].sort()
    );
  });

  it("buckets a single response's places back into per-category counts by their own types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          places: [
            { rating: 4.2, types: ["restaurant", "food"] },
            { rating: 4.0, types: ["gym"] },
            { rating: 3.9, types: ["cafe", "restaurant"] },
            { rating: 4.5, types: ["grocery_store"] },
            { rating: 4.1, types: ["pharmacy"] },
          ],
        }),
      })
    );

    const summary = await fetchAmenitySummary({ latitude: 1, longitude: 2 }, "key");

    expect(summary).toEqual({ food: 2, gym: 1, coffee: 1, grocery: 2 });
  });

  it("drops places below the minimum rating bar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ places: [{ rating: 2.5, types: ["restaurant"] }] }),
      })
    );

    const summary = await fetchAmenitySummary({ latitude: 1, longitude: 2 }, "key");

    expect(summary).toEqual({ food: 0, gym: 0, coffee: 0, grocery: 0 });
  });

  it("counts a place toward every category it matches, not just one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          places: [{ rating: 4.5, types: ["cafe", "restaurant"] }],
        }),
      })
    );

    const summary = await fetchAmenitySummary({ latitude: 1, longitude: 2 }, "key");

    expect(summary).toEqual({ food: 1, gym: 0, coffee: 1, grocery: 0 });
  });

  it("returns all-zero counts rather than null when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const summary = await fetchAmenitySummary({ latitude: 1, longitude: 2 }, "key");

    expect(summary).toEqual({ food: 0, gym: 0, coffee: 0, grocery: 0 });
  });

  it("returns null without calling fetch when there's no location", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summary = await fetchAmenitySummary(null, "key");

    expect(summary).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
