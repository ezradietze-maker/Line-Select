import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The trade board is a membership feature: once `FREE_FOR_ALL` is flipped off (it stays on in the app; here
 * `hasAccess` is `isMember`, as it then is), a confirmed pilot with no membership can't post, answer or agree an offer,
 * find trades or say yes to one. Only posting and finding were gated: the rest of a trade went through. Saying no,
 * which only takes a pilot off a trade, stays open, and a free member gets through.
 */

const PILOT = "11111111-1111-4111-8111-111111111111";
const PACK = "uploaded-mem-md11-fo-oct26";
const META = { base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26" };
const state = vi.hoisted(() => ({ freeMemberAt: null as string | null, calls: [] as string[], offerIsOthers: false }));
const did = (what: string) => state.calls.push(what);

vi.mock("@/lib/membership", async (real) => {
  const m = await real<typeof import("@/lib/membership")>();
  return { ...m, hasAccess: m.isMember };
});
// Made after the cutover, so it's no older account kept in.
vi.mock("@/lib/server/auth", () => ({
  getCurrentServerUser: async () => ({ id: PILOT, displayName: "J Pilot", email: "j@example.com", emailVerified: true, createdAt: "2027-01-05T00:00:00.000Z", plan: "free", freeMemberAt: state.freeMemberAt }),
}));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/trade-board-bar", () => ({ tradeBoardIsOpen: async () => true }));
vi.mock("@/lib/server/trade-pack", () => ({ accountPackFingerprint: async () => "fp" }));
vi.mock("@/lib/server/trade-matching", () => ({ runMatching: async () => (did("find"), { status: "ran", found: 0, pilots: 3 }) }));
vi.mock("@/lib/server/trade-suggestions", () => ({
  lapseSuggestionsFor: async () => undefined,
  listMatchingGroup: async () => ({ rows: [], names: new Map(), fingerprints: new Map() }),
  listSuggestionsFor: async () => [],
  answerSuggestion: async (_id: string, _u: string, answer: string) => (did(`answer:${answer}`), { ok: false, reason: "not-found" }),
}));
const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: ["ANC"], international: false, reportTime: "early", creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0, tripId: "t1", startDayIndex: 2 };
vi.mock("@/lib/server/db", () => ({
  isUuid: () => true,
  pilotHasSeatMonth: async () => true,
  getTradeHolding: async () => ({ packId: PACK, bidPackMeta: META, lineNumber: "1", trips: [{ id: "t1", startDayIndex: 2, lock: null }], confirmedAt: "" }),
  getTradeSettings: async () => ({ suggestMe: true, emailMatches: false }),
  getPreferenceProfile: async () => null,
  getBidPackRecord: async () => ({ packId: PACK, data: Buffer.from(""), updatedAt: "", fingerprint: null }),
  saveTradeHolding: async (_u: string, h: unknown) => (did("hold"), h),
  createTradeOffer: async () => (did("post"), true),
  // Another pilot's open offer to answer, or this pilot's own with a proposal on it to agree.
  findTradeOffer: async () => ({ id: "o1", bidPackMeta: META, offeringUserId: state.offerIsOthers ? "someone-else" : PILOT, offeredTrip: trip, wantedPairingNumber: null, status: state.offerIsOthers ? "open" : "pending", respondedAt: null }),
  respondToTradeOffer: async () => (did("respond"), null),
  acceptTradeOffer: async () => (did("accept"), null),
  listTradeOffersForSeat: async (_m: unknown, _v: string, opts: { othersOpen: boolean }) => (did(`board:${opts.othersOpen ? "others" : "own"}`), []),
}));

const board = await import("@/app/api/trades/route");
const respond = await import("@/app/api/trades/[id]/respond/route");
const accept = await import("@/app/api/trades/[id]/accept/route");
const matches = await import("@/app/api/trades/matches/route");
const answer = await import("@/app/api/trades/matches/[id]/answer/route");

const post = (url: string, body: unknown) => new Request(`https://example.com${url}`, { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "o1" }) };

const ACTIONS: [string, string, () => Promise<Response>][] = [
  ["posting an offer", "post", () => board.POST(post("/api/trades", { bidPackMeta: META, offeredTrip: trip }))],
  ["answering an offer", "respond", () => ((state.offerIsOthers = true), respond.POST)(post("/api/trades/o1/respond", { responderTrip: trip }), params)],
  ["agreeing a trade", "accept", () => accept.POST(post("/api/trades/o1/accept", {}), params)],
  ["finding trades", "find", () => matches.POST(post("/api/trades/matches", { pack: PACK }))],
  ["saying yes to a suggested trade", "answer:accepted", () => answer.POST(post("/api/trades/matches/x/answer", { answer: "accepted" }), params)],
];

beforeEach(() => {
  state.freeMemberAt = null;
  state.calls = [];
  state.offerIsOthers = false;
});

describe("a confirmed pilot with no membership", () => {
  for (const [name, call, run] of ACTIONS) {
    it(`is refused ${name}, and pointed at Membership`, async () => {
      const res = await run();
      expect(res.status).toBe(402);
      expect((await res.json()).upgrade).toBe("/membership");
      expect(state.calls).not.toContain(call);
    });
  }

  it("can still say no to a suggested trade, which only takes it off", async () => {
    await answer.POST(post("/api/trades/matches/x/answer", { answer: "declined" }), params);
    expect(state.calls).toContain("answer:declined");
  });
});

describe("a free member", () => {
  for (const [name, call, run] of ACTIONS) {
    it(`gets past the gate for ${name}`, async () => {
      state.freeMemberAt = "2027-01-06T00:00:00.000Z";
      const res = await run();
      expect(res.status).not.toBe(402);
      expect(state.calls).toContain(call);
    });
  }
});
