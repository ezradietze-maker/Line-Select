import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory KV, never Redis or the local file.
const store = new Map<string, unknown>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (k: string) => (store.has(k) ? store.get(k) : null),
  setJson: async (k: string, v: unknown) => void store.set(k, v),
  incrementCounter: async (k: string) => {
    const n = ((store.get(k) as number) ?? 0) + 1;
    store.set(k, n);
    return n;
  },
  addToCounter: async (k: string, a: number) => {
    const n = ((store.get(k) as number) ?? 0) + a;
    store.set(k, n);
    return n;
  },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => null }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: async () => {}, noteActivity: async () => {} }));

const { GET } = await import("./route");
const { rememberPackHotels } = await import("@/lib/server/pack-hotels");

let googleCalls = 0;
beforeEach(() => {
  store.clear();
  googleCalls = 0;
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "fake");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      googleCalls++;
      await new Promise((r) => setTimeout(r, 50));
      if (String(url).includes("searchNearby")) return { ok: true, json: async () => ({ places: [] }) };
      return {
        ok: true,
        json: async () => ({ places: [{ id: "p1", displayName: { text: "Hilton Memphis" }, rating: 4.2, formattedAddress: "939 Ridge Lake Blvd, Memphis, TN 38120, USA", location: { latitude: 35.1, longitude: -89.87 } }] }),
      };
    })
  );
});

const req = () => new Request("http://x/api/hotels?code=MEM&name=HILTON", { headers: { "x-forwarded-for": "203.0.113.9", cookie: "line-select-device=d1" } });

describe("the same uncached hotel asked for at once", () => {
  it("is looked up on Google once, and every copy gets the answer", async () => {
    await rememberPackHotels({ trips: [{ city: "MEM", hotelName: "HILTON" }] });
    const once = async () => {
      await GET(req());
      return googleCalls;
    };
    const alone = await once();
    store.clear();
    await rememberPackHotels({ trips: [{ city: "MEM", hotelName: "HILTON" }] });
    googleCalls = 0;
    const results = await Promise.all(Array.from({ length: 10 }, () => GET(req()).then((r) => r.json())));
    expect(results.every((r) => r.hotel)).toBe(true);
    expect(googleCalls).toBe(alone);
  });
});
