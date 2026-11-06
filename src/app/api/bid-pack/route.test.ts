import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string } | null = null;
const saved = new Map<string, { packId: string; data: Buffer; updatedAt: string }>();
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/db", () => ({
  getBidPackRecord: async (id: string) => saved.get(id) ?? null,
  saveBidPackRecord: async (id: string, packId: string, data: Buffer) => void saved.set(id, { packId, data, updatedAt: "2026-11-06T00:00:00.000Z" }),
  deleteBidPackRecord: async (id: string) => void saved.delete(id),
}));

const { GET, PUT } = await import("./route");

const packBytes = (pack: unknown) => gzipSync(Buffer.from(JSON.stringify(pack)));
const put = (body: Uint8Array) => PUT(new Request("https://example.com/api/bid-pack", { method: "PUT", body: body as BodyInit }));
const real = { id: "uploaded-mem-cap-nov26", format: 2, lines: [], tripTable: {} };

beforeEach(() => {
  user = { id: "pilot-1" };
  saved.clear();
});

describe("/api/bid-pack", () => {
  it("keeps a signed-in pilot's pack and gives the same bytes back", async () => {
    const bytes = packBytes(real);
    expect((await put(bytes)).status).toBe(200);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get("x-pack-id")!)).toBe(real.id);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("answers 204 when nothing is saved, and 401 for a guest", async () => {
    expect((await GET()).status).toBe(204);
    user = null;
    expect((await GET()).status).toBe(401);
    expect((await put(packBytes(real))).status).toBe(401);
  });

  it("refuses anything that isn't a gzipped pack", async () => {
    expect((await put(Buffer.from("not gzip"))).status).toBe(400);
    expect((await put(packBytes({ hello: "world" }))).status).toBe(400);
    expect(saved.size).toBe(0);
  });

  it("doesn't keep the demo pack", async () => {
    expect(await (await put(packBytes({ ...real, id: "sample-bidpack" }))).json()).toEqual({ saved: false });
    expect(saved.size).toBe(0);
  });
});
