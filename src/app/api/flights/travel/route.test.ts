import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, number>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => store.get(key) ?? null,
  setJson: async (key: string, value: number) => void store.set(key, value),
  addToCounter: async (key: string, amount: number) => {
    const next = (store.get(key) ?? 0) + amount;
    store.set(key, next);
    return next;
  },
  incrementCounter: async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
}));
const auth = vi.hoisted(() => ({ user: null as { id: string; emailVerified?: boolean } | null }));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => auth.user }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/email", () => ({ sendEmail: vi.fn() }));
// A lookup that wants 10,000 new boards and fetches as many as it's allowed.
const lookup = vi.hoisted(() => ({ wants: 10_000 }));
const answerTravelNeeds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/flight-schedules", () => ({
  answerTravelNeeds,
  flightDataConfigured: () => true,
  boardCostUsd: () => 0.001,
}));

const { POST } = await import("./route");

const COST = 0.001;
const DEVICE = "11111111-1111-4111-8111-111111111111";

function request(cookie = `ls_device=${DEVICE}`) {
  const departAfter = Date.now() + 10 * 24 * 3600_000;
  return new Request("http://x/api/flights/travel", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9", cookie },
    body: JSON.stringify({ needs: [{ id: "n1", tripId: "t1", kind: "toBase", from: ["XNA"], to: ["MEM"], departAfter, departBefore: departAfter + 3600_000 }] }),
  });
}

const lastAllowed = vi.hoisted(() => ({ boards: 0 }));
/** How many boards the last lookup was allowed in all, asked for as it went. */
const allowed = () => lastAllowed.boards;
const spentBy = (who: string) => (store.get(`line-select:spend:who:${new Date().toISOString().slice(0, 10)}:flights:${who}`) ?? 0) / 1_000_000;
const siteSpent = () => (store.get(`line-select:spend:site:${new Date().toISOString().slice(0, 10)}`) ?? 0) / 1_000_000;

beforeEach(() => {
  store.clear();
  auth.user = null;
  lookup.wants = 10_000;
  // Asks for boards a few at a time, as the real lookup does, until it has all it wants or none are left.
  answerTravelNeeds.mockReset().mockImplementation(async (_n: unknown, _j: unknown, o: { maxBoards: number; moreBoards?: (want: number) => Promise<number> }) => {
    let have = o.maxBoards;
    while (have < lookup.wants && o.moreBoards) {
      const got = await o.moreBoards(Math.min(10, lookup.wants - have));
      if (got <= 0) break;
      have += got;
    }
    lastAllowed.boards = have;
    const fetched = Math.min(lookup.wants, have);
    return { answers: [], stats: { fetched, cached: 0, skipped: lookup.wants - fetched, boardsLeft: have - fetched } };
  });
  delete process.env.SPEND_SITE_DAILY_USD;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("/api/flights/travel spending", () => {
  it("gives a guest a small allowance and a signed-in pilot more", async () => {
    await POST(request());
    const guestBoards = allowed();
    store.clear();
    auth.user = { id: "pilot-1", emailVerified: true };
    await POST(request());
    expect(guestBoards).toBeCloseTo(0.5 / COST);
    expect(allowed()).toBeCloseTo(2 / COST);
  });

  it("stops new boards once the allowance is spent, and still answers from the cache", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(spentBy(`device:${DEVICE}`)).toBeCloseTo(0.5);
    const again = await POST(request());
    expect(again.status).toBe(200);
    expect(allowed()).toBe(0);
    expect(spentBy(`device:${DEVICE}`)).toBeCloseTo(0.5);
  });

  it("charges nothing for an answer that came entirely from the cache", async () => {
    lookup.wants = 0;
    await POST(request());
    expect(siteSpent()).toBe(0);
    // What was held for the lookup is all given back.
    expect([...store].filter(([k]) => k.includes(":spend:")).every(([, v]) => v === 0)).toBe(true);
  });

  it("gives two small lookups at the same moment what each needs, not all of it to the first", async () => {
    auth.user = { id: "pilot-1", emailVerified: true };
    lookup.wants = 20;
    const results = await Promise.all([POST(request()), POST(request())]);
    for (const r of results) expect((await r.json()).partial).toBeUndefined();
    expect(spentBy("u:pilot-1")).toBeCloseTo(40 * COST);
  });

  it("lets two lookups at the same moment share the allowance, not each spend all of it", async () => {
    await Promise.all([POST(request()), POST(request())]);
    expect(spentBy(`device:${DEVICE}`)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("charges what was really fetched, to the pilot and the site but not their AI allowance", async () => {
    auth.user = { id: "pilot-1", emailVerified: true };
    lookup.wants = 300;
    await POST(request());
    expect(spentBy("u:pilot-1")).toBeCloseTo(0.3);
    expect(siteSpent()).toBeCloseTo(0.3);
    expect(store.has(`line-select:spend:who:${new Date().toISOString().slice(0, 10)}:u:pilot-1`)).toBe(false);
  });

  it("holds every guest on one address to a shared allowance, so clearing cookies buys only so much", async () => {
    for (let i = 0; i < 6; i++) await POST(request(`ls_device=${String(i).repeat(8)}-1111-4111-8111-111111111111`));
    expect(spentBy("address:203.0.113.9")).toBeCloseTo(2.5);
    await POST(request("ls_device=99999999-1111-4111-8111-111111111111"));
    expect(allowed()).toBe(0);
  });

  it("stops new boards for everyone at the site's daily ceiling", async () => {
    process.env.SPEND_SITE_DAILY_USD = "0.01";
    auth.user = { id: "pilot-1", emailVerified: true };
    await POST(request());
    expect(allowed()).toBeCloseTo(10);
    auth.user = { id: "pilot-2", emailVerified: true };
    await POST(request());
    expect(allowed()).toBe(0);
  });

  it("still has its rate limit", async () => {
    for (let i = 0; i < 20; i++) expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
  });

  it("passes a question's allowed detour to the search, and refuses one too wide", async () => {
    const asked = (maxDetour: unknown) => {
      const r = request();
      return r.json().then((body) => {
        body.needs[0].maxDetour = maxDetour;
        return new Request(r.url, { method: "POST", headers: r.headers, body: JSON.stringify(body) });
      });
    };
    expect((await POST(await asked(2))).status).toBe(200);
    expect(answerTravelNeeds.mock.lastCall![0][0].maxDetour).toBe(2);
    expect((await POST(await asked(5))).status).toBe(400);
    expect((await POST(await asked("wide"))).status).toBe(400);
  });

  it("says when boards were held back, so a no isn't taken as certain", async () => {
    answerTravelNeeds.mockResolvedValueOnce({ answers: [], stats: { fetched: 0, cached: 0, skipped: 3, boardsLeft: 0 } });
    expect((await (await POST(request())).json()).partial).toBe(true);
    answerTravelNeeds.mockResolvedValueOnce({ answers: [], stats: { fetched: 0, cached: 0, skipped: 0, boardsLeft: 9 } });
    expect((await (await POST(request())).json()).partial).toBeUndefined();
  });
});
