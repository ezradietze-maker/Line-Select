import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory KV, never Redis or the local file.
const store = new Map<string, number | unknown>();
const add = (k: string, a: number) => {
  const n = ((store.get(k) as number) ?? 0) + a;
  store.set(k, n);
  return n;
};
vi.mock("@/lib/server/kv", () => ({
  getJson: async (k: string) => (store.has(k) ? store.get(k) : null),
  setJson: async (k: string, v: unknown) => void store.set(k, v),
  incrementCounter: async (k: string) => add(k, 1),
  addToCounter: async (k: string, a: number) => add(k, a),
  takeSlot: async (k: string, limit: number) => {
    if (((store.get(k) as number) ?? 0) >= limit) return false;
    add(k, 1);
    return true;
  },
  releaseSlot: async (k: string) => {
    if (add(k, -1) <= 0) store.delete(k);
  },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => null }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: async () => {}, noteActivity: async () => {} }));
vi.mock("@/lib/server/email", () => ({ sendEmail: async () => true }));

const model = vi.hoisted(() => ({ calls: 0, costUsd: 0.1, fail: false }));
// Each model call takes a moment, as a real one does, so a burst's calls are all running at once.
vi.mock("@/lib/brain/ask-pack", async (real) => ({
  ...(await real<typeof import("@/lib/brain/ask-pack")>()),
  readAskQuery: async () => {
    model.calls++;
    await new Promise((r) => setTimeout(r, 50));
    if (model.fail) throw Object.assign(new Error("ran out of room"), { usage: { costUsd: 0.02 } });
    return { query: { conditions: [] }, usage: { costUsd: model.costUsd, ms: 50 } };
  },
}));

const { POST } = await import("./route");
const { askQueryCeilingUsd } = await import("@/lib/brain/ask-pack");

const today = () => new Date().toISOString().slice(0, 10);
const guestSpent = () => ((store.get(`line-select:spend:who:${today()}:ip:198.51.100.7`) as number) ?? 0) / 1e6;
const body = { question: "which lines have the most days off?", packBrief: "x".repeat(70_000) };
const req = (headers: Record<string, string> = {}) =>
  new Request("http://x/api/brain/ask", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.7", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  store.clear();
  model.calls = 0;
  model.costUsd = 0.1;
  model.fail = false;
  vi.stubEnv("ANTHROPIC_API_KEY", "fake");
  vi.stubEnv("SPEND_IN_FLIGHT_PER_PILOT", "");
  vi.stubEnv("SPEND_IN_FLIGHT_PER_ADDRESS", "");
});

describe("Ask your pack under a burst from one guest", () => {
  it("holds fifty calls sent at once to the $2 guest ceiling and one call's hold", async () => {
    // Places in flight out of the way, so this is the holds alone.
    vi.stubEnv("SPEND_IN_FLIGHT_PER_PILOT", "1000");
    vi.stubEnv("SPEND_IN_FLIGHT_PER_ADDRESS", "1000");
    const results = await Promise.all(Array.from({ length: 50 }, () => POST(req())));
    const hold = askQueryCeilingUsd(body);
    expect(hold).toBeGreaterThan(model.costUsd);
    expect(guestSpent()).toBeLessThanOrEqual(2 + hold);
    expect(model.calls).toBeLessThanOrEqual(Math.ceil(2 / hold));
    expect(results.filter((r) => r.status === 200)).toHaveLength(model.calls);
    expect(results.filter((r) => r.status === 429).length).toBe(50 - model.calls);
    // Before the fix all fifty ran: $15 against the $2 ceiling at $0.30 a call.
  });

  it("lets only four of them run at once", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => POST(req())));
    expect(model.calls).toBe(4);
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(guestSpent()).toBeCloseTo(0.4, 6);
    expect(await results.find((r) => r.status === 429)!.json()).toEqual({ error: expect.stringContaining("running already") });
    // All given back once they're done.
    expect([...store.keys()].filter((k) => k.includes(":in-flight:"))).toEqual([]);
  });
});

describe("Ask your pack, one call at a time", () => {
  it("records what the call really cost", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(guestSpent()).toBeCloseTo(0.1, 6);
    expect((await POST(req())).status).toBe(200);
    expect(guestSpent()).toBeCloseTo(0.2, 6);
  });

  it("records only what a failed call was billed", async () => {
    model.fail = true;
    expect((await POST(req())).status).toBe(502);
    expect(guestSpent()).toBeCloseTo(0.02, 6);
  });

  it("answers a resend after a dropped connection from the first answer, paid for once", async () => {
    const id = { "x-request-id": "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b" };
    const first = await POST(req(id));
    const again = await POST(req(id));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(model.calls).toBe(1);
    expect(guestSpent()).toBeCloseTo(0.1, 6);
  });

  it("stops a guest at the ceiling", async () => {
    model.costUsd = 1;
    expect((await POST(req())).status).toBe(200);
    expect((await POST(req())).status).toBe(200);
    expect((await POST(req())).status).toBe(429);
    expect(model.calls).toBe(2);
  });
});
