import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every trade action an account whose email isn't confirmed can't take: posting, answering or agreeing an offer, saying
 * what it holds, finding trades and saying yes to one. Each is refused with words that say to confirm the email (and
 * `confirmEmail`, which shows the button), nothing is stored, and a confirmed pilot gets through the same door.
 */

const PILOT = "11111111-1111-4111-8111-111111111111";
const PACK = "uploaded-mem-md11-fo-oct26";
const META = { base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26" };
const state = vi.hoisted(() => ({ verified: true, calls: [] as string[], offerIsOthers: false }));
const did = (what: string) => state.calls.push(what);

vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => ({ id: PILOT, displayName: "J Pilot", email: "j@example.com", emailVerified: state.verified }) }));
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
const holding = await import("@/app/api/trades/holding/route");
const matches = await import("@/app/api/trades/matches/route");
const answer = await import("@/app/api/trades/matches/[id]/answer/route");

const post = (url: string, body: unknown, method = "POST") => new Request(`https://example.com${url}`, { method, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "o1" }) };

const ACTIONS: [string, string, () => Promise<Response>][] = [
  ["posting an offer", "post", () => board.POST(post("/api/trades", { bidPackMeta: META, offeredTrip: trip }))],
  ["answering an offer", "respond", () => ((state.offerIsOthers = true), respond.POST)(post("/api/trades/o1/respond", { responderTrip: trip }), { params: Promise.resolve({ id: "o1" }) })],
  ["agreeing a trade", "accept", () => accept.POST(post("/api/trades/o1/accept", {}), params)],
  ["saying what it holds", "hold", () => holding.PUT(post(`/api/trades/holding`, { packId: PACK, bidPackMeta: META, lineNumber: "1", trips: [{ id: "t1", startDayIndex: 2, lock: null }] }, "PUT"))],
  ["finding trades", "find", () => matches.POST(post("/api/trades/matches", { pack: PACK }))],
  ["saying yes to a suggested trade", "answer:accepted", () => answer.POST(post("/api/trades/matches/x/answer", { answer: "accepted" }), params)],
];

beforeEach(() => {
  state.verified = true;
  state.calls = [];
  state.offerIsOthers = false;
});

describe("an account whose email isn't confirmed", () => {
  for (const [name, call, run] of ACTIONS) {
    it(`is refused ${name}, with a "Confirm your email" answer, and nothing happens`, async () => {
      state.verified = false;
      const res = await run();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.confirmEmail).toBe(true);
      expect(body.error).toMatch(/^Confirm your email to /);
      expect(state.calls).not.toContain(call);
    });
  }

  it("can still say no to a suggested trade, which only takes it off", async () => {
    state.verified = false;
    await answer.POST(post("/api/trades/matches/x/answer", { answer: "declined" }), params);
    expect(state.calls).toContain("answer:declined");
  });

  it("sees its own offers on the board, but not other pilots'", async () => {
    state.verified = false;
    await board.GET(new Request("https://example.com/api/trades?base=MEM&aircraft=MD11&seat=FO&month=OCT26"));
    expect(state.calls).toEqual(["board:own"]);
    state.verified = true;
    await board.GET(new Request("https://example.com/api/trades?base=MEM&aircraft=MD11&seat=FO&month=OCT26"));
    expect(state.calls.at(-1)).toBe("board:others");
  });
});

describe("a confirmed pilot", () => {
  for (const [name, call, run] of ACTIONS) {
    it(`gets past the gate for ${name}`, async () => {
      const res = await run();
      const body = await res.clone().json().catch(() => ({}));
      expect(body.confirmEmail).toBeUndefined();
      expect(state.calls).toContain(call);
    });
  }
});
