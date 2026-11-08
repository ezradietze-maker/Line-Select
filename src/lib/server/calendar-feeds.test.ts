import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedMonth } from "@/lib/calendar-feed";
import type { BidPack } from "@/types/bidpack";

// A small stand-in for the one table: enough to prove what's stored, what's revoked and what's looked up.
const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const paid = vi.hoisted(() => ({ answerTravelNeeds: vi.fn() }));
const dbFns = vi.hoisted(() => ({ getBidPackRecord: vi.fn(), getPreferenceProfile: vi.fn() }));
vi.mock("@/lib/server/db", () => dbFns);
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/flight-schedules", () => ({ answerTravelNeeds: paid.answerTravelNeeds, flightDataConfigured: () => true }));
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  and: (...parts: unknown[]) => (row: Record<string, unknown>) => parts.every((p) => (p as (r: Record<string, unknown>) => boolean)(row)),
  eq: (col: { name: string }, value: unknown) => (row: Record<string, unknown>) => row[col.name] === value,
  isNull: (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] === null,
}));
vi.mock("@/lib/server/postgres", () => {
  const keyed = (r: Record<string, unknown>) => ({ ...r, id: r.id, userId: r.user_id, tokenHash: r.token_hash, createdAt: r.created_at, revokedAt: r.revoked_at });
  const snake = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));
  const db = {
    select: () => ({
      from: () => ({ where: (w: (r: Record<string, unknown>) => boolean) => ({ limit: async () => store.rows.filter(w).map(keyed) }) }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async (w: (r: Record<string, unknown>) => boolean) => {
          for (const r of store.rows.filter(w)) Object.assign(r, snake(s));
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `f${store.rows.length}`, created_at: new Date(0), revoked_at: null, ...snake(v) };
          store.rows.push(row);
          return [keyed(row)];
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});

import { feedForToken, feedStatus, hashFeedToken, revokeFeed, setFeedOptions, startFeed, syncFeed } from "@/lib/server/calendar-feeds";

function trip() {
  return {
    id: "t1", pairingNumber: "27", days: 1, layoverCities: [], layoverDetails: [], reportTime: "early", international: false, deadheadLegs: 0,
    creditHours: 5, landings: 1, departures: 1, tafbHours: 8, zuluAnchor: "", startDayIndex: 2,
    schedule: [{ reportTimeLocal: "0930", startMinutes: 0, legs: [{ flightNumber: "1", equipment: "76", isDeadhead: false, depAirport: "MEM", depTimeLocal: "1000", depTimeGmt: "1500", arrAirport: "IND", arrTimeLocal: "1200", arrTimeGmt: "1600", blockHours: 1, startMinutes: 30, endMinutes: 90, depTimeZulu: "", arrTimeZulu: "" }], layover: null }],
  };
}
const line = (lineNumber: string) => ({ id: lineNumber, lineNumber, trips: [trip()], daysOff: 1, totalCreditHours: 5, totalTafbHours: 8, totalLandings: 1, totalDepartures: 1 });
const PACK = { id: "pack-1", month: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line("1004"), line("1005")] } as unknown as BidPack;
const choice = { packId: "pack-1", lineNumber: "1004", lineSource: "top" as const, pilotClose: null };
const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  store.rows.length = 0;
  dbFns.getBidPackRecord.mockResolvedValue({ packId: "pack-1", data: gzipSync(JSON.stringify(PACK)), updatedAt: "" });
  dbFns.getPreferenceProfile.mockResolvedValue(null);
  paid.answerTravelNeeds.mockResolvedValue({ answers: [], stats: {} });
});

describe("links", () => {
  it("stores only a hash of the token, and finds the feed by the token", async () => {
    const { token } = await startFeed(USER);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(store.rows)).not.toContain(token);
    expect(store.rows[0].token_hash).toBe(hashFeedToken(token));
    expect(await feedForToken(token)).toMatchObject({ months: [] });
  });

  it("makes a different link every time", async () => {
    const a = await startFeed(USER);
    const b = await startFeed(USER);
    expect(a.token).not.toBe(b.token);
  });

  it("a new link kills the old one and keeps what it carried", async () => {
    const first = await startFeed(USER, { homeDays: true });
    await syncFeed(USER, choice);
    const second = await startFeed(USER);
    expect(await feedForToken(first.token)).toBeNull();
    const now = await feedForToken(second.token);
    expect(now?.options.homeDays).toBe(true);
    expect((now?.months as FeedMonth[])[0].lineNumber).toBe("1004");
    // Nothing kept on the dead row.
    expect(store.rows[0].months).toEqual([]);
  });

  it("turning off kills the link and clears the trips kept for it", async () => {
    const { token } = await startFeed(USER);
    await syncFeed(USER, choice);
    await revokeFeed(USER);
    expect(await feedForToken(token)).toBeNull();
    expect(store.rows[0].months).toEqual([]);
    expect(store.rows[0].revoked_at).toBeInstanceOf(Date);
    expect(await feedStatus(USER)).toEqual({ on: false });
  });

  it("doesn't look anything up for a malformed token", async () => {
    await startFeed(USER);
    expect(await feedForToken("short")).toBeNull();
  });

  it("changes an option on the live link", async () => {
    await startFeed(USER);
    expect((await setFeedOptions(USER, { homeDays: true })).options?.homeDays).toBe(true);
  });
});

describe("syncFeed", () => {
  it("does nothing, and reads no pack, with no live link", async () => {
    expect(await syncFeed(USER, choice)).toBe("off");
    expect(dbFns.getBidPackRecord).not.toHaveBeenCalled();
  });

  it("says when the stored pack isn't this one", async () => {
    await startFeed(USER);
    expect(await syncFeed(USER, { ...choice, packId: "other" })).toBe("pack-not-saved");
  });

  it("builds this month's line from the stored pack", async () => {
    const { token } = await startFeed(USER);
    expect(await syncFeed(USER, choice)).toBe("ok");
    const months = (await feedForToken(token))!.months;
    expect(months[0]).toMatchObject({ month: "OCT26", lineNumber: "1004", lineSource: "top" });
    expect(months[0].trips).toHaveLength(1);
    expect(await feedStatus(USER)).toMatchObject({ on: true, month: "OCT26", lineNumber: "1004", lineSource: "top" });
  });

  it("follows a new #1", async () => {
    const { token } = await startFeed(USER);
    await syncFeed(USER, choice);
    await syncFeed(USER, { ...choice, lineNumber: "1005" }, Date.now() + 1000);
    const months = (await feedForToken(token))!.months;
    expect(months).toHaveLength(1);
    expect(months[0].lineNumber).toBe("1005");
  });

  it("an award on the account beats a #1 from a device that hasn't heard of it", async () => {
    const { token } = await startFeed(USER);
    dbFns.getPreferenceProfile.mockResolvedValue({ logbook: [{ id: "x", bidPackId: "pack-1", base: "MEM", aircraft: "MD11", seat: "CAP", month: "OCT26", outcome: "line", lineNumber: "1005", loggedAt: "" }] });
    await syncFeed(USER, choice);
    expect((await feedForToken(token))!.months[0]).toMatchObject({ lineNumber: "1005", lineSource: "awarded" });
  });

  it("an award that wasn't a line shows no trips", async () => {
    const { token } = await startFeed(USER);
    dbFns.getPreferenceProfile.mockResolvedValue({ logbook: [{ id: "x", bidPackId: "pack-1", base: "MEM", aircraft: "MD11", seat: "CAP", month: "OCT26", outcome: "reserve", loggedAt: "" }] });
    await syncFeed(USER, choice);
    expect((await feedForToken(token))!.months[0]).toMatchObject({ lineNumber: null, trips: [] });
  });

  it("asks for cached flights only, and only for a commuter", async () => {
    await startFeed(USER);
    await syncFeed(USER, choice);
    expect(paid.answerTravelNeeds).not.toHaveBeenCalled();
    dbFns.getPreferenceProfile.mockResolvedValue({ pilotModel: { home: { commuter: true, airports: ["SAN"] } } });
    await syncFeed(USER, choice);
    expect(paid.answerTravelNeeds).toHaveBeenCalledTimes(1);
    expect(paid.answerTravelNeeds.mock.calls[0][2]).toEqual({ maxBoards: 0 });
  });

  it("a flight problem doesn't stop the feed", async () => {
    const { token } = await startFeed(USER);
    dbFns.getPreferenceProfile.mockResolvedValue({ pilotModel: { home: { commuter: true, airports: ["SAN"] } } });
    paid.answerTravelNeeds.mockRejectedValue(new Error("kv down"));
    expect(await syncFeed(USER, choice)).toBe("ok");
    expect((await feedForToken(token))!.months[0].trips).toHaveLength(1);
  });
});
