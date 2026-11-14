import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string; emailVerified?: boolean } | null = null;
const held = new Map<string, unknown>();
let limited = false;
let accountPack: string | null = "uploaded-mem-md11-fo-oct26";
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => user }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: !limited }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/db", () => ({
  getTradeHolding: async (u: string, p: string) => held.get(`${u}|${p}`) ?? null,
  getTradeSettings: async () => ({ suggestMe: true, emailMatches: false }),
  saveTradeHolding: async (u: string, h: { packId: string }, fingerprint: string | null) => {
    fingerprinted.push(fingerprint);
    held.set(`${u}|${h.packId}`, h);
    return h;
  },
  deleteTradeHolding: async (u: string, p: string) => void held.delete(`${u}|${p}`),
  getBidPackRecord: async () => (accountPack ? { packId: accountPack, data: Buffer.from(""), updatedAt: "", fingerprint: null } : null),
  freeOffersOfTripsNotHeld: async (...args: unknown[]) => void freed.push(args),
}));
const freed = vi.hoisted(() => [] as unknown[][]);

const fingerprinted = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/server/trade-pack", () => ({ accountPackFingerprint: async () => "fp-1" }));

const lapsed: unknown[][] = [];
vi.mock("@/lib/server/trade-suggestions", () => ({ lapseSuggestionsFor: async (...args: unknown[]) => void lapsed.push(args) }));

const { GET, PUT, DELETE } = await import("./route");

const PACK = "uploaded-mem-md11-fo-oct26";
const url = `https://example.com/api/trades/holding?pack=${PACK}`;
const body = { packId: PACK, bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26" }, lineNumber: "2001", trips: [{ id: "t", startDayIndex: 3, lock: null }] };
const put = (b: unknown = body) => PUT(new Request(url, { method: "PUT", body: JSON.stringify(b) }));

beforeEach(() => {
  user = { id: "pilot-1", emailVerified: true };
  held.clear();
  limited = false;
  accountPack = PACK;
  lapsed.length = 0;
});

describe("/api/trades/holding", () => {
  it("keeps what a pilot confirms, for that pack", async () => {
    expect((await put()).status).toBe(200);
    expect((await (await GET(new Request(url))).json()).holding).toEqual(body);
    // With the copy of the pack it was confirmed on.
    expect(fingerprinted.at(-1)).toBe("fp-1");
    expect((await (await GET(new Request("https://example.com/api/trades/holding?pack=other"))).json()).holding).toBeNull();
  });

  it("keeps each pilot's apart", async () => {
    await put();
    user = { id: "pilot-2", emailVerified: true };
    expect((await (await GET(new Request(url))).json()).holding).toBeNull();
  });

  it("removes it when asked", async () => {
    await put();
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(200);
    expect((await (await GET(new Request(url))).json()).holding).toBeNull();
  });

  it("lapses suggestions worked out from what they held before, when it changes or goes", async () => {
    await put();
    expect(lapsed).toEqual([["pilot-1", PACK]]);
    await DELETE(new Request(url, { method: "DELETE" }));
    expect(lapsed).toHaveLength(2);
  });

  it("frees the pilot's board offers of trips no longer on what they hold", async () => {
    freed.length = 0;
    await put();
    expect(freed).toEqual([["pilot-1", body]]);
  });

  it("refuses anyone not signed in", async () => {
    user = null;
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await put()).status).toBe(401);
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(401);
    expect(held.size).toBe(0);
  });

  it("refuses the sample pack and anything malformed", async () => {
    expect((await put({ ...body, packId: "sample-bidpack" })).status).toBe(400);
    expect((await put({ ...body, trips: [] })).status).toBe(400);
    expect(held.size).toBe(0);
  });

  it("refuses a seat that isn't the pack's, and the older id that doesn't name the aircraft", async () => {
    // An MD11 FO pack's id with a B777 captain's seat would open that seat's board to them.
    expect((await put({ ...body, bidPackMeta: { base: "MEM", aircraft: "B777", seat: "CAP", month: "OCT26" } })).status).toBe(400);
    expect((await put({ ...body, packId: "uploaded-mem-fo-oct26" })).status).toBe(400);
    expect(held.size).toBe(0);
  });

  it("takes only the pack on the pilot's account", async () => {
    accountPack = "uploaded-mem-md11-fo-nov26";
    expect((await put()).status).toBe(409);
    accountPack = null;
    expect((await put()).status).toBe(409);
    expect(held.size).toBe(0);
  });

  it("has a rate limit", async () => {
    limited = true;
    expect((await GET(new Request(url))).status).toBe(429);
    expect((await put()).status).toBe(429);
  });
});
