import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => auth.user }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/forecast-store", () => ({ hashUser: (id: string) => `hash:${id}` }));
const records = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/learning-store", () => ({ listPilotHoldRecords: records }));
vi.mock("@/lib/learning/hold-history", () => ({ summarizeHoldHistory: () => ({ months: 0 }) }));
const store = new Map<string, number>();
vi.mock("@/lib/server/kv", () => ({
  incrementCounter: async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  store.clear();
  records.mockReset().mockResolvedValue([]);
  auth.user = { id: "pilot-1" };
});

describe("/api/learning/hold-history", () => {
  it("answers up to its hourly limit for one account, then stops without touching the database", async () => {
    for (let i = 0; i < 120; i++) expect((await GET()).status).toBe(200);
    records.mockClear();
    expect((await GET()).status).toBe(429);
    expect(records).not.toHaveBeenCalled();
  });

  it("gives each account its own count", async () => {
    for (let i = 0; i < 121; i++) await GET();
    auth.user = { id: "pilot-2" };
    expect((await GET()).status).toBe(200);
  });

  it("refuses a signed-out request before counting anything", async () => {
    auth.user = null;
    expect((await GET()).status).toBe(401);
    expect(store.size).toBe(0);
  });
});
