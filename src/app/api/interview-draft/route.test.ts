import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string } | null = null;
const store = new Map<string, unknown>();
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/kv", () => ({ getJson: async (k: string) => store.get(k) ?? null, setJson: async (k: string, v: unknown) => void store.set(k, v) }));

const { GET, PUT, DELETE } = await import("./route");

const url = (pack?: string) => `https://example.com/api/interview-draft${pack ? `?pack=${encodeURIComponent(pack)}` : ""}`;
const get = async (pack?: string) => GET(new Request(url(pack)));
const put = (body: unknown) => PUT(new Request(url(), { method: "PUT", body: JSON.stringify(body) }));
const draft = { version: 1, savedAt: 1, exchanges: [{ turn: 0, question: "Walk us through how you bid", answer: "Fewest departures" }] };

beforeEach(() => {
  user = { id: "pilot-1" };
  store.clear();
});

describe("/api/interview-draft", () => {
  it("keeps a signed-in pilot's unfinished interview for that pack, and gives it back", async () => {
    expect((await put({ pack: "uploaded-mem-cap-nov26", draft })).status).toBe(200);
    expect(await (await get("uploaded-mem-cap-nov26")).json()).toEqual({ draft });
    expect(await (await get("another-pack")).json()).toEqual({ draft: null });
  });

  it("keeps each pilot's draft apart", async () => {
    await put({ pack: "p", draft });
    user = { id: "pilot-2" };
    expect(await (await get("p")).json()).toEqual({ draft: null });
  });

  it("clears it when the interview is done or started fresh", async () => {
    await put({ pack: "p", draft });
    expect((await DELETE(new Request(url("p"), { method: "DELETE" }))).status).toBe(200);
    expect(await (await get("p")).json()).toEqual({ draft: null });
  });

  it("is for signed-in pilots only, and takes only a draft for a named pack", async () => {
    user = null;
    expect((await get("p")).status).toBe(401);
    expect((await put({ pack: "p", draft })).status).toBe(401);
    user = { id: "pilot-1" };
    expect((await get()).status).toBe(400);
    expect((await put({ draft })).status).toBe(400);
    expect((await put({ pack: "p", draft: "not a draft" })).status).toBe(400);
    expect((await put({ pack: "p", draft: { big: "x".repeat(700_000) } })).status).toBe(400);
    expect(store.size).toBe(0);
  });
});
