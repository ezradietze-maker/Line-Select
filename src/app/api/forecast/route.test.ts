import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURE_COUNT } from "@/lib/forecast/features";

const authMocks = vi.hoisted(() => ({ getCurrentServerUser: vi.fn() }));
vi.mock("@/lib/server/auth", () => authMocks);

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => kv.store.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    kv.store.set(key, JSON.parse(JSON.stringify(value)));
  }),
  incrementCounter: vi.fn(async () => 1),
}));

import { DELETE, POST } from "./route";

const LINES = 12;
const lineNumbers = Array.from({ length: LINES }, (_, i) => String(1000 + i));
const lineIds = lineNumbers.map((n) => `line-${n}`);
// Line i differs from line 0 in one feature, enough for the simulation to have something to rank.
const features = Array.from({ length: LINES * FEATURE_COUNT }, (_, i) => Math.sin(i * 1.7) * 1.2);
const seniorityList = Array.from({ length: 20 }, (_, i) => [i + 1, (i + 1) * 5]);
const USER = { id: "user-1", email: "a@example.com", displayName: "A", createdAt: "", plan: "free" as const };

function request(body: object, method = "POST") {
  return new Request("http://localhost/api/forecast", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function goodBody(overrides: Record<string, unknown> = {}) {
  return {
    packKey: "oct26|mem|b777|cap",
    lineIds,
    lineNumbers,
    features,
    seniorityList,
    regularLines: LINES,
    dropoutRate: 0.08,
    seniorityNumber: 50, // bid position 10
    ranking: Array.from({ length: LINES }, (_, i) => i),
    share: false,
    ...overrides,
  };
}

describe("/api/forecast", () => {
  beforeEach(() => {
    kv.store.clear();
    authMocks.getCurrentServerUser.mockReset().mockResolvedValue(null);
  });

  it("returns a forecast built from numbers alone", async () => {
    const res = await POST(request(goodBody()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.forecast.myBidNumber).toBe(10);
    expect(Object.keys(data.forecast.lines)).toHaveLength(LINES);
    expect(data.shared).toBe("not-requested");
  });

  it("rejects malformed input with a 400 rather than running anything", async () => {
    for (const bad of [
      { packKey: "x" },
      goodBody({ features: [1, 2, 3] }),
      goodBody({ seniorityNumber: -4 }),
      goodBody({ ranking: [0, 99] }),
      goodBody({ seniorityList: [[1]] }),
      goodBody({ lineIds: [] }),
    ]) {
      expect((await POST(request(bad))).status).toBe(400);
    }
  });

  it("stores a signed-in pilot's shared ranking, keyed by a hash of their account and never their name", async () => {
    authMocks.getCurrentServerUser.mockResolvedValue(USER);
    const res = await POST(request(goodBody({ share: true })));
    expect((await res.json()).shared).toBe("stored");
    const stored = JSON.stringify([...kv.store.values()]);
    expect(stored).not.toContain("user-1");
    expect(stored).not.toContain("a@example.com");
    expect(stored).toContain('"b":10');
  });

  it("does not store anything for a guest, or for a seniority number that isn't on the list", async () => {
    expect((await (await POST(request(goodBody({ share: true })))).json()).shared).toBe("not-signed-in");
    authMocks.getCurrentServerUser.mockResolvedValue(USER);
    expect((await (await POST(request(goodBody({ share: true, seniorityNumber: 52 })))).json()).shared).toBe("unlisted");
    expect(kv.store.size).toBe(0);
  });

  it("uses other pilots' shared rankings but never sends them back", async () => {
    authMocks.getCurrentServerUser.mockResolvedValue(USER);
    await POST(request(goodBody({ share: true, seniorityNumber: 25, ranking: [3, 4, 5, 0, 1, 2, 6, 7, 8, 9, 10, 11] })));
    authMocks.getCurrentServerUser.mockResolvedValue(null);
    const data = await (await POST(request(goodBody({ seniorityNumber: 50 })))).json();
    expect(data.crowd.pilotsSharing).toBe(1);
    expect(data.forecast.knownAhead).toBe(1);
    expect(data.forecast.lines["line-1003"].pAvailable).toBe(0); // pilot 5 (seniority 25) takes their top line for certain
    const text = JSON.stringify(data);
    expect(text).not.toContain("ranking");
  });

  it("lets a different account not take over a claimed bid position", async () => {
    authMocks.getCurrentServerUser.mockResolvedValue(USER);
    await POST(request(goodBody({ share: true })));
    authMocks.getCurrentServerUser.mockResolvedValue({ ...USER, id: "user-2" });
    expect((await (await POST(request(goodBody({ share: true })))).json()).shared).toBe("position-taken");
  });

  it("removes a pilot's stored ranking when they stop sharing", async () => {
    authMocks.getCurrentServerUser.mockResolvedValue(USER);
    await POST(request(goodBody({ share: true })));
    const del = await DELETE(request({ packKey: "oct26|mem|b777|cap", lineNumbers }, "DELETE"));
    expect(del.status).toBe(200);
    authMocks.getCurrentServerUser.mockResolvedValue(null);
    expect((await (await POST(request(goodBody({ seniorityNumber: 100 })))).json()).crowd.pilotsSharing).toBe(0);
  });

  it("refuses to delete for someone who isn't signed in", async () => {
    expect((await DELETE(request({ packKey: "x", lineNumbers }, "DELETE"))).status).toBe(401);
  });
});
