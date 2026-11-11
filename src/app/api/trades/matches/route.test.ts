import { afterEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => ({ id: "pilot-1", displayName: "J Pilot" }) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: async (bucket: string, _id: string, limit: number) => {
    limits.set(bucket, limit);
    return { ok: true };
  },
  rateLimitedResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/server/db", () => ({ getPreferenceProfile: async () => null, getTradeHolding: async () => null, getTradeSettings: async () => ({ suggestMe: true, emailMatches: false }) }));
vi.mock("@/lib/server/trade-matching", () => ({ runMatching: vi.fn() }));
vi.mock("@/lib/server/trade-suggestions", () => ({ listMatchingGroup: async () => ({ rows: [] }), listSuggestionsFor: async () => [] }));

const { GET } = await import("./route");
const { fetchSuggestions } = await import("@/lib/trades/holding-client");

afterEach(() => vi.unstubAllGlobals());

describe("reading suggested trades", () => {
  it("allows a few open windows' polling in an hour", async () => {
    await GET(new Request("https://example.com/api/trades/matches?waiting&pack=p"));
    // Each window: the Inbox badge every 10 s, and the Trade Board's list every 20 s.
    const perWindow = 3600 / 10 + 3600 / 20;
    expect(limits.get("trade-matches-read")).toBeGreaterThanOrEqual(4 * perWindow);
  });

  it("tells the screen when it's been turned away for asking too often, not just that it failed", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 429 }));
    expect(await fetchSuggestions("p")).toBe("limited");
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    expect(await fetchSuggestions("p")).toBeNull();
  });
});
