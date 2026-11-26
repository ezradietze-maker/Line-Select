import { describe, expect, it, vi } from "vitest";

let healthy = true;
vi.mock("@/lib/server/health", () => ({
  checkHealth: async () => ({ ok: healthy, redis: "ok", database: healthy ? "ok" : "down", databaseCheckedAt: "2026-11-26T12:00:00.000Z" }),
}));

const { GET } = await import("./route");

describe("GET /api/health", () => {
  it("answers 200 while everything answers, never cached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("answers 503 when a store is down, so a monitor calls the site down", async () => {
    healthy = false;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, database: "down" });
  });
});
