import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BidPackMetaSnapshot } from "@/types/trade";

const meta = (seat: string, month = "DEC26"): BidPackMetaSnapshot => ({ base: "MEM", aircraft: "MD11", seat, month });
const packOf = (month = "DEC26", start = "2026-11-30") => ({ id: `uploaded-mem-md11-fo-${month.toLowerCase()}`, base: "MEM", aircraft: "MD11", seat: "FO", month, bidPeriodStart: start, bidPeriodDays: 28, lines: [], format: 2, tripTable: [] });

const state = vi.hoisted(() => ({
  groups: [] as BidPackMetaSnapshot[],
  open: new Set<string>(),
  packs: new Map<string, unknown>(),
  rows: [] as unknown[],
  trades: [] as unknown[],
  saved: [] as unknown[],
  emailed: [] as unknown[],
  failSeat: null as string | null,
  history: { boardTrips: [] as unknown[], boardSwaps: [] as unknown[], busyPilots: new Set<string>(), signatures: new Set<string>(), declined: new Set<string>(), refusedTrips: new Set<string>(), minGains: new Map<string, number>(), holdingDoubted: new Map<string, Date>() },
  options: [] as Record<string, (...a: never[]) => unknown>[],
  fingerprints: new Map<string, string | null>(),
  matched: [] as unknown[],
  available: [] as { pilotId: string }[],
}));

vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/kv", () => ({ incrementCounter: async () => 1, setJson: vi.fn() }));
vi.mock("@/lib/server/trade-board-bar", () => ({ tradeBoardIsOpen: async (seat: { seat: string }) => state.open.has(seat.seat) }));
vi.mock("@/lib/server/trade-email", () => ({
  emailNewTrade: async (t: unknown) => {
    state.emailed.push(t);
    return 1;
  },
}));
const record = (u: string) => ({ userId: u, packId: "uploaded-mem-md11-fo-dec26", data: gzipSync(JSON.stringify(state.packs.get(u))), fingerprint: null });
vi.mock("@/lib/server/db", () => ({
  getTradeHolding: async () => ({ bidPackMeta: meta("FO") }),
  getBidPackRecord: async (u: string) => (state.packs.has(u) ? record(u) : null),
  setBidPackFingerprint: async () => {},
  setHoldingFingerprint: async () => {},
  // Any account in the list whose pack has the fingerprint asked for.
  bidPackRecordWithFingerprint: async (ids: string[], fingerprint: string) => {
    const { tradePackFingerprint } = await import("@/lib/server/pack-fingerprint");
    const { restoreBidPack } = await import("@/lib/bidpack-storage");
    const u = ids.find((id) => state.packs.has(id) && tradePackFingerprint(restoreBidPack(state.packs.get(id) as never)) === fingerprint);
    return u ? record(u) : null;
  },
}));
vi.mock("@/lib/server/trade-suggestions", () => ({
  listActiveGroups: async (min: number) => (min === 2 ? state.groups : []),
  listMatchingGroup: async (m: BidPackMetaSnapshot) => {
    if (m.seat === state.failSeat) throw new Error("boom");
    return { rows: state.rows, names: new Map(), fingerprints: new Map(state.fingerprints) };
  },
  matchingHistory: async () => state.history,
  lapseUnanswered: async () => {},
  saveSuggestion: async (s: unknown) => {
    state.saved.push(s);
    return true;
  },
  tradeDayCounts: async () => ({ suggested: { 2: 1, 4: 2 }, yes: 3, no: 1, noBecause: { trip: 1 }, finished: 1, lapsed: 0 }),
  refusedTripKey: (u: string, t: { id: string }) => `${u}|${t.id}`,
  swapKey: (u: string, g: { id: string }, t: { id: string }) => `${u}|${g.id}|${t.id}`,
}));
vi.mock("@/lib/trades/holding", () => ({
  pilotsForMatching: (_p: unknown, rows: unknown[]) => {
    state.matched = rows;
    return [{ pilotId: "a", line: { trips: [{ id: "t1", startDayIndex: 3, pairingNumber: "11" }] } }, { pilotId: "b", line: { trips: [] } }];
  },
}));
vi.mock("@/lib/trades/match", () => ({
  findTrades: (_p: unknown, available: { pilotId: string }[], options: Record<string, (...a: never[]) => unknown>) => {
    state.options.push(options);
    state.available = available;
    return { trades: state.trades };
  },
}));
vi.mock("@/lib/trades/suggestions", () => ({
  suggestionToStore: (_p: unknown, t: unknown) => t,
  tradeSignature: () => "sig",
}));

const { runDailyMatching, runMatching, tradeSummaryText } = await import("./trade-matching");

const now = new Date("2026-12-05T12:00:00Z");
const trade = { legs: [{ pilotId: "a", value: { give: { id: "t1" } } }, { pilotId: "b", value: { give: { id: "t2" } } }] };

beforeEach(() => {
  state.groups = [meta("FO")];
  state.open = new Set(["FO"]);
  state.packs = new Map([["u1", packOf()]]);
  state.rows = [{ userId: "u1", holding: { packId: "uploaded-mem-md11-fo-dec26", confirmedAt: "2026-12-01T00:00:00.000Z" } }];
  state.fingerprints = new Map();
  state.matched = [];
  state.trades = [trade];
  state.saved = [];
  state.emailed = [];
  state.failSeat = null;
  state.options = [];
  state.history = { boardTrips: [], boardSwaps: [], busyPilots: new Set(), signatures: new Set(), declined: new Set(), refusedTrips: new Set(), minGains: new Map(), holdingDoubted: new Map() };
});

describe("the daily run", () => {
  it("stores what it finds and tells those who asked", async () => {
    expect(await runDailyMatching(now)).toEqual({ groups: 1, skipped: 0, found: 1, failed: 0, notReached: 0 });
    expect(state.saved).toEqual([trade]);
    expect(state.emailed).toEqual([trade]);
  });

  it("leaves alone a seat whose Trade Board hasn't opened", async () => {
    state.open = new Set();
    expect(await runDailyMatching(now)).toMatchObject({ skipped: 1, found: 0 });
    expect(state.saved).toEqual([]);
  });

  it("leaves alone a month that's over", async () => {
    state.packs = new Map([["u1", packOf()]]);
    expect(await runDailyMatching(new Date("2027-02-01T00:00:00Z"))).toMatchObject({ skipped: 1, found: 0 });
  });

  it("skips a group with no pack left on any account", async () => {
    state.packs = new Map();
    expect(await runDailyMatching(now)).toMatchObject({ skipped: 1, found: 0 });
  });

  it("keeps going past a seat that fails, and says so", async () => {
    state.groups = [meta("CAP"), meta("FO")];
    state.open = new Set(["CAP", "FO"]);
    state.failSeat = "CAP";
    expect(await runDailyMatching(now)).toMatchObject({ groups: 2, failed: 1, found: 1 });
  });

  it("stops when out of time, leaving the rest for tomorrow", async () => {
    state.groups = [meta("FO"), meta("CAP")];
    expect(await runDailyMatching(now, -1)).toMatchObject({ notReached: 2, found: 0 });
  });

  it("offers nothing a pilot has refused, and asks more of one who said it wasn't worth it", async () => {
    state.history.declined.add("a|t1|t9");
    state.history.refusedTrips.add("b|t7");
    state.history.minGains.set("c", 6);
    await runDailyMatching(now);
    const { excludeSwap, minGainFor } = state.options[0] as unknown as { excludeSwap: (p: string, g: { id: string }, t: { id: string }) => boolean; minGainFor: (p: string) => number | undefined };
    expect(excludeSwap("a", { id: "t1" }, { id: "t9" })).toBe(true);
    expect(excludeSwap("a", { id: "t2" }, { id: "t9" })).toBe(false);
    expect(excludeSwap("b", { id: "anything" }, { id: "t7" })).toBe(true);
    expect(minGainFor("c")).toBe(6);
    expect(minGainFor("a")).toBeUndefined();
  });

  it("leaves out a pilot who said a trade wasn't what they hold, until they confirm what they do", async () => {
    state.history.holdingDoubted.set("a", new Date("2026-12-02T00:00:00Z"));
    state.rows = [{ userId: "u1", holding: { packId: "uploaded-mem-md11-fo-dec26", confirmedAt: "2026-12-01T00:00:00.000Z" } }];
    // The mocked group holds pilots "a" and "b"; "a" has no holding confirmed since saying so.
    await runDailyMatching(now);
    expect(state.available.map((p) => p.pilotId)).toEqual(["b"]);
  });

  it("never hands on a trip its pilot agreed to trade on the board", async () => {
    state.history.boardTrips = [{ pilot: "a", trip: { tripId: "t1", startDayIndex: 3, pairingNumber: "11", lineNumber: "1001" } }];
    await runDailyMatching(now);
    const [a, b] = state.available as unknown as { locked?: Set<string> }[];
    expect([...(a.locked ?? [])]).toEqual(["t1@3"]);
    expect(b.locked).toBeUndefined();
  });

  it("fits what it hands a pilot around what they take on the board: one taking a trip the pack can't place is left out", async () => {
    const given = { tripId: "t1", startDayIndex: 3, pairingNumber: "11", lineNumber: "1001" };
    state.history.boardTrips = [{ pilot: "a", trip: given }];
    state.history.boardSwaps = [{ pilot: "a", give: given, take: { tripId: "t9", startDayIndex: 8, pairingNumber: "19", lineNumber: "1002" } }];
    await runDailyMatching(now);
    expect(state.available.map((p) => p.pilotId)).toEqual(["b"]);
  });

  it("doesn't store the same trade twice", async () => {
    state.history.signatures.add("sig");
    expect(await runDailyMatching(now)).toMatchObject({ found: 0 });
    expect(state.saved).toEqual([]);
  });
});

describe("a pilot pressing Find trades", () => {
  it("is told when their seat's board hasn't opened", async () => {
    state.open = new Set();
    expect(await runMatching("u1", "uploaded-mem-md11-fo-dec26", now.getTime())).toEqual({ status: "closed" });
  });

  it("is told when their account doesn't have this pack", async () => {
    expect(await runMatching("no-pack", "uploaded-mem-md11-fo-dec26", now.getTime())).toEqual({ status: "not-ready" });
  });

  it("runs the search otherwise", async () => {
    expect(await runMatching("u1", "uploaded-mem-md11-fo-dec26", now.getTime())).toEqual({ status: "ran", found: 1, pilots: 2 });
  });

  it("is told when what they hold was confirmed on a different copy of the pack from most of their seat", async () => {
    const { tradePackFingerprint } = await import("@/lib/server/pack-fingerprint");
    const { restoreBidPack } = await import("@/lib/bidpack-storage");
    const group = tradePackFingerprint(restoreBidPack(packOf() as never));
    const confirmedAt = "2026-12-01T00:00:00.000Z";
    state.packs = new Map([["u1", packOf()], ["u2", packOf()], ["u3", packOf()]]);
    state.rows = ["u1", "u2", "u3"].map((userId) => ({ userId, holding: { packId: "uploaded-mem-md11-fo-dec26", confirmedAt } }));
    state.fingerprints = new Map([["u1", "edited"], ["u2", group], ["u3", group]]);
    expect(await runMatching("u1", "uploaded-mem-md11-fo-dec26", now.getTime())).toEqual({ status: "pack-differs" });
    // Matched without them: only what was confirmed on the group's pack.
    expect(await runMatching("u2", "uploaded-mem-md11-fo-dec26", now.getTime())).toMatchObject({ status: "ran" });
    expect((state.matched as { userId: string }[]).map((r) => r.userId)).toEqual(["u2", "u3"]);
  });
});

describe("the owner's morning summary", () => {
  it("says what the run did and how trades were answered", async () => {
    const text = await tradeSummaryText({ groups: 2, skipped: 1, found: 3, failed: 0, notReached: 0 }, now);
    expect(text).toContain("2 seats");
    expect(text).toContain("3 new trades");
    expect(text).toContain("1 of 2 pilots, 2 of 4 pilots suggested");
    expect(text).toContain("3 yes, 1 no (didn't want the trip: 1)");
  });

  it("flags a failure", async () => {
    expect(await tradeSummaryText({ groups: 1, skipped: 0, found: 0, failed: 1, notReached: 0 }, now)).toContain("1 FAILED");
  });
});
