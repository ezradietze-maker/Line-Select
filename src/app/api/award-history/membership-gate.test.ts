import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bid forecast and award history are part of what a membership unlocks: once `FREE_FOR_ALL` is flipped off (it
 * stays on in the app; here `hasAccess` is `isMember`, as it then is), a pilot with no membership is turned away with
 * a 402 before anything is read. Reporting your own award and deleting it stay open to everyone.
 */

const PILOT = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ freeMemberAt: null as string | null, reads: 0 }));

vi.mock("@/lib/membership", async (real) => {
  const m = await real<typeof import("@/lib/membership")>();
  return { ...m, hasAccess: m.isMember };
});
// Made after the cutover, so it's no older account kept in.
vi.mock("@/lib/server/auth", () => ({
  getCurrentServerUser: async () => ({ id: PILOT, displayName: "J Pilot", email: "j@example.com", emailVerified: true, createdAt: "2027-01-05T00:00:00.000Z", plan: "free", freeMemberAt: state.freeMemberAt }),
}));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  checkRequestLimit: async () => ({ ok: true }),
  rateLimitedResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/server/verified-pilots", async (real) => ({
  ...(await real<typeof import("@/lib/server/verified-pilots")>()),
  isVerified: () => true,
  verifiedPilotHashes: async () => (state.reads++, new Set<string>()),
}));
vi.mock("@/lib/server/db", async (real) => ({
  ...(await real<typeof import("@/lib/server/db")>()),
  listAwardRowsForSeat: async () => (state.reads++, []),
}));
vi.mock("@/lib/server/forecast-store", () => ({
  blobKey: () => "k",
  hashUser: () => "h",
  loadKnownRankings: async () => (state.reads++, { total: 0, rankings: [] }),
  removeSubmission: async () => undefined,
  saveSubmission: async () => undefined,
}));

const awardHistory = await import("@/app/api/award-history/route");
const heldBy = await import("@/app/api/award-history/held-by/route");
const forecast = await import("@/app/api/forecast/route");

beforeEach(() => {
  state.freeMemberAt = null;
  state.reads = 0;
});

describe("membership gate on the forecast and award history", () => {
  it("turns a pilot with no membership away from the award history before reading it", async () => {
    const res = await awardHistory.GET(new Request("https://example.com/api/award-history?base=MEM&aircraft=MD11&seat=FO"));
    expect(res.status).toBe(402);
    expect((await res.json()).upgrade).toBe("/membership");
    expect(state.reads).toBe(0);
  });

  it("turns a pilot with no membership away from who held what", async () => {
    const res = await heldBy.GET(new Request("https://example.com/api/award-history/held-by?base=MEM&aircraft=MD11&seat=FO&month=OCT26"));
    expect(res.status).toBe(402);
    expect(state.reads).toBe(0);
  });

  it("turns a pilot with no membership away from the bid forecast", async () => {
    const res = await forecast.POST(new Request("https://example.com/api/forecast", { method: "POST", body: "{}" }));
    expect(res.status).toBe(402);
    expect(state.reads).toBe(0);
  });

  it("lets a free member read the award history", async () => {
    state.freeMemberAt = "2027-01-06T00:00:00.000Z";
    const res = await awardHistory.GET(new Request("https://example.com/api/award-history?base=MEM&aircraft=MD11&seat=FO"));
    expect(res.status).toBe(200);
  });
});
