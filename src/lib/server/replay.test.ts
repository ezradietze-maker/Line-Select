import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>(), counts: new Map<string, number>() }));
vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (k: string) => kv.store.get(k) ?? null),
  setJson: vi.fn(async (k: string, v: unknown) => {
    kv.store.set(k, v);
  }),
  incrementCounter: vi.fn(async (k: string) => {
    const n = (kv.counts.get(k) ?? 0) + 1;
    kv.counts.set(k, n);
    return n;
  }),
}));
vi.mock("@/lib/server/rate-limit", () => ({ clientIp: () => "1.1.1.1", deviceIdFrom: () => "device" }));

const { onceForRequest, onceForStream } = await import("./replay");
const ID = "11111111-1111-4111-8111-111111111111";
const req = (id: string | null = ID) => new Request("https://example.com/api/x", { method: "POST", headers: id ? { "x-request-id": id } : {} });

beforeEach(() => {
  kv.store.clear();
  kv.counts.clear();
});

describe("a streamed paid call sent twice", () => {
  it("runs once: the resend gets the remembered reply as plain JSON", async () => {
    const run = vi.fn(async (remember: (s: number, b: unknown) => Promise<void>) => {
      await remember(200, { answer: "kept" });
      return new Response("stream");
    });
    expect(await (await onceForStream(req(), 1000, run)).text()).toBe("stream");
    const again = await onceForStream(req(), 1000, run);
    expect(await again.json()).toEqual({ answer: "kept" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again once the first copy has failed", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async (remember: (s: number, b: unknown) => Promise<void>) => {
        await remember(502, null);
        return new Response("stream");
      });
      await onceForStream(req(), 5000, run);
      const second = onceForStream(req(), 5000, run);
      await vi.advanceTimersByTimeAsync(2000);
      await second;
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("just runs without a request id", async () => {
    const run = vi.fn(async () => new Response("stream"));
    await onceForStream(req(null), 1000, run);
    await onceForStream(req(null), 1000, run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("a plain paid call sent twice still works as before", () => {
  it("hands the kept reply to the resend", async () => {
    const run = vi.fn(async () => Response.json({ ok: 1 }));
    await onceForRequest(req(), 1000, run);
    expect(await (await onceForRequest(req(), 1000, run)).json()).toEqual({ ok: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing from a failed reply", async () => {
    await onceForRequest(req(), 1000, async () => Response.json({ error: "x" }, { status: 502 }));
    expect([...kv.store.keys()].some((k) => k.endsWith(":reply"))).toBe(false);
    expect([...kv.store.keys()].some((k) => k.endsWith(":failed"))).toBe(true);
  });
});
