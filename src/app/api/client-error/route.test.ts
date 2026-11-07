import { beforeEach, describe, expect, it, vi } from "vitest";

const reported: { kind: string; error: Error; context: Record<string, unknown> }[] = [];
let allowed = true;
vi.mock("@/lib/server/alerts", () => ({ reportProblem: async (kind: string, error: Error, context: Record<string, unknown>) => void reported.push({ kind, error, context }) }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRequestLimit: async () => ({ ok: allowed }) }));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new Request("https://example.com/api/client-error", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  reported.length = 0;
  allowed = true;
});

describe("/api/client-error", () => {
  it("reports a browser crash to the owner's alerts, with where it happened", async () => {
    expect((await post({ message: "TypeError: x is undefined", stack: "at LineCard (LineCard.tsx:12)", where: "card", page: "/results" })).status).toBe(204);
    expect(reported).toHaveLength(1);
    expect(reported[0].kind).toBe("browser");
    expect(reported[0].error.message).toBe("TypeError: x is undefined");
    expect(reported[0].error.stack).toContain("LineCard");
    expect(reported[0].context).toEqual({ where: "card", page: "/results" });
  });

  it("drops a malformed or capped report without a word", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post({ stack: "no message" })).status).toBe(204);
    expect((await post({ message: "x".repeat(600) })).status).toBe(204);
    allowed = false;
    expect((await post({ message: "TypeError" })).status).toBe(204);
    expect(reported).toHaveLength(0);
  });
});
