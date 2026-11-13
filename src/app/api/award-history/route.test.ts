import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { awardHistoryRecords } from "@/lib/server/schema";
import type { AwardRow } from "@/lib/server/award-aggregate";

const mocks = vi.hoisted(() => ({
  user: vi.fn<() => Promise<{ id: string; email: string; displayName: string; emailVerified?: boolean } | null>>(async () => null),
  rows: vi.fn<() => Promise<AwardRow[]>>(async () => []),
  packRows: vi.fn<() => Promise<AwardRow[]>>(async () => []),
  create: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  remove: vi.fn<(...args: unknown[]) => Promise<number>>(async () => 3),
  active: vi.fn<() => Promise<{ sampleSize: number } | null>>(async () => null),
  // Which tags belong to confirmed accounts; null for every one of them.
  verified: { only: null as Set<string> | null },
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: mocks.user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), checkRequestLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/db", () => ({ listAwardRowsForSeat: mocks.rows, listAwardRowsForPack: mocks.packRows, createAwardHistoryRecord: mocks.create, deleteAwardShares: mocks.remove }));
vi.mock("@/lib/server/learning-store", () => ({ awardedChoiceFromPrediction: async () => null, loadActiveModel: mocks.active }));
vi.mock("@/lib/server/learning-runner", () => ({ maybeLearn: async () => {} }));
vi.mock("@/lib/server/after-response", () => ({ afterResponse: () => {} }));
vi.mock("@/lib/server/forecast-store", async () => ({ hashUser: (await import("@/lib/server/pilot-hash")).hashUser }));
vi.mock("@/lib/server/verified-pilots", async (real) => ({
  ...(await real<typeof import("@/lib/server/verified-pilots")>()),
  verifiedPilotHashes: async () => mocks.verified.only ?? { has: () => true },
}));

const { GET, POST, DELETE } = await import("./route");
const { GET: heldBy } = await import("./held-by/route");

const URL_BASE = "https://example.com/api/award-history";
const pilot = { id: "11111111-1111-4111-8111-111111111111", email: "someone@example.com", displayName: "Some Pilot", emailVerified: true };
const row = (i: number, over: Partial<AwardRow> = {}): AwardRow => ({ pilotHash: `hash${i}`, seniorityRank: i + 1, seniorityTotalPilots: 100, outcome: "line", lineNumber: String(1000 + i), daysOff: 15, totalCreditHours: 70, holderShown: true, submittedAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000), ...over });
const post = (body: unknown) => new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) });
const report = { base: "MEM", aircraft: "MD11", seat: "CAP", month: "OCT26", seniorityRank: 12, seniorityTotalPilots: 100, outcome: "line", lineNumber: "1033", daysOff: 15, totalCreditHours: 70, totalTafbHours: 200 };

beforeEach(() => {
  for (const m of [mocks.user, mocks.rows, mocks.packRows, mocks.create, mocks.remove, mocks.active]) m.mockClear();
  mocks.verified.only = null;
  mocks.user.mockResolvedValue(null);
  mocks.rows.mockResolvedValue([]);
  mocks.packRows.mockResolvedValue([]);
  mocks.active.mockResolvedValue(null);
});

describe("what's stored", () => {
  it("has nowhere to put a name, an email, an employee number or an account id", () => {
    const columns = Object.values(getTableColumns(awardHistoryRecords)).map((c) => c.name);
    for (const c of columns) expect(c).not.toMatch(/name|email|employee|emp_|user_id|account/i);
  });

  it("drops anything extra a client sends", async () => {
    mocks.user.mockResolvedValue(pilot);
    await POST(post({ ...report, name: "J Smith", employeeNumber: "123456", email: "x@y.z", userId: pilot.id }));
    const stored = JSON.stringify(mocks.create.mock.calls[0]);
    expect(stored).not.toMatch(/J Smith|123456|x@y\.z|someone@example|Some Pilot/);
    expect(stored).not.toContain(pilot.id);
  });

  it("tags the row with a one-way hash, not the account id", async () => {
    mocks.user.mockResolvedValue(pilot);
    await POST(post(report));
    const link = mocks.create.mock.calls[0][1] as { pilotHash: string };
    expect(link.pilotHash).toMatch(/^[0-9a-f]{20}$/);
  });

  it("only shows a holder when the pilot said yes, and only for a line", async () => {
    mocks.user.mockResolvedValue(pilot);
    await POST(post(report));
    // Not said: the report this replaces keeps its answer (see the next test).
    expect((mocks.create.mock.calls[0][1] as { holderShown?: boolean }).holderShown).toBeUndefined();
    await POST(post({ ...report, holderShown: "true" }));
    expect(mocks.create.mock.calls[1][1]).toMatchObject({ holderShown: false });
    await POST(post({ ...report, holderShown: true }));
    expect(mocks.create.mock.calls[2][1]).toMatchObject({ holderShown: true });
    await POST(post({ ...report, outcome: "reserve", lineNumber: null, holderShown: true }));
    expect(mocks.create.mock.calls[3][1]).toMatchObject({ holderShown: false });
    await POST(post({ ...report, seniorityRank: 500, holderShown: true }));
    expect(mocks.create.mock.calls[4][1]).toMatchObject({ holderShown: false });
  });

  it("leaves out what a report didn't say, so the one it replaces keeps it", async () => {
    mocks.user.mockResolvedValue(pilot);
    // Strategies' form: no answer on the number, how the month flew, or which brain ranked it.
    await POST(post(report));
    const link = mocks.create.mock.calls[0][1] as Record<string, unknown>;
    for (const key of ["holderShown", "monthFeel", "brainVersion", "notesUsed"]) expect(link[key]).toBeUndefined();
    // The Logbook's: each said, even when the answer is none.
    await POST(post({ ...report, holderShown: false, monthFeel: null, brainVersion: 27, notesUsed: false }));
    expect(mocks.create.mock.calls[1][1]).toMatchObject({ holderShown: false, monthFeel: null, brainVersion: 27, notesUsed: false });
    // A reserve month never shows a number, said or not.
    await POST(post({ ...report, outcome: "reserve", lineNumber: null }));
    expect(mocks.create.mock.calls[2][1]).toMatchObject({ holderShown: false });
  });
});

describe("the open listing", () => {
  const get = () => GET(new Request(`${URL_BASE}?base=MEM&aircraft=MD11&seat=CAP`));

  it("returns no single report, hash or line, even with plenty of pilots", async () => {
    mocks.rows.mockResolvedValue(Array.from({ length: 30 }, (_, i) => row(i)));
    const text = await (await get()).text();
    expect(text).not.toMatch(/hash|1003|lineNumber|seniorityRank|records|"id"/);
    expect(JSON.parse(text).bands[0].avgDaysOff).toBe(15);
  });

  it("holds back a small group", async () => {
    mocks.rows.mockResolvedValue([row(0), row(1), row(2)]);
    const { bands } = await (await get()).json();
    expect(bands[0]).toEqual({ reports: 0, avgDaysOff: null, avgCreditHours: null, lineRate: null });
  });
});

describe("who held what", () => {
  const get = () => heldBy(new Request(`${URL_BASE}/held-by?base=MEM&aircraft=MD11&seat=CAP&month=OCT26`));

  it("needs a signed-in pilot", async () => {
    mocks.packRows.mockResolvedValue(Array.from({ length: 8 }, (_, i) => row(i)));
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("1003");
    expect(mocks.packRows).not.toHaveBeenCalled();
  });

  it("gives lines and places, no hash, once enough have agreed", async () => {
    mocks.user.mockResolvedValue(pilot);
    mocks.packRows.mockResolvedValue(Array.from({ length: 5 }, (_, i) => row(i)));
    const text = await (await get()).text();
    expect(text).not.toMatch(/hash|email|name/i);
    expect(JSON.parse(text).holders).toHaveLength(5);
  });

  it("gives nothing below the bar", async () => {
    mocks.user.mockResolvedValue(pilot);
    mocks.packRows.mockResolvedValue(Array.from({ length: 4 }, (_, i) => row(i)));
    expect((await (await get()).json()).holders).toEqual([]);
  });

  it("looks the pack up by its key, and says how far the odds have been checked", async () => {
    mocks.user.mockResolvedValue(pilot);
    mocks.active.mockResolvedValue({ sampleSize: 42 });
    expect((await (await get()).json()).oddsCheckedAgainst).toBe(42);
    expect(mocks.packRows).toHaveBeenCalledWith("oct26|mem|md11|cap");
  });
});

describe("an account whose email isn't confirmed", () => {
  const unconfirmed = { ...pilot, emailVerified: false };

  it("can't share what it held, and is told to confirm its email", async () => {
    mocks.user.mockResolvedValue(unconfirmed);
    const res = await POST(post(report));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ confirmEmail: true, error: expect.stringMatching(/^Confirm your email/) });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("can't see who held what", async () => {
    mocks.user.mockResolvedValue(unconfirmed);
    mocks.packRows.mockResolvedValue(Array.from({ length: 8 }, (_, i) => row(i)));
    const res = await heldBy(new Request(`${URL_BASE}/held-by?base=MEM&aircraft=MD11&seat=CAP&month=OCT26`));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("1003");
  });

  it("doesn't count toward group numbers: four confirmed pilots and one not are short of five", async () => {
    mocks.rows.mockResolvedValue(Array.from({ length: 5 }, (_, i) => row(i)));
    mocks.verified.only = new Set(["hash0", "hash1", "hash2", "hash3"]);
    const get = async () => (await GET(new Request(`${URL_BASE}?base=MEM&aircraft=MD11&seat=CAP`))).json();
    expect((await get()).totalReports).toBe(0);
    mocks.verified.only.add("hash4");
    expect((await get()).totalReports).toBe(5);
  });

  it("doesn't count toward Held by, nor is its claim shown", async () => {
    mocks.user.mockResolvedValue(pilot);
    mocks.packRows.mockResolvedValue(Array.from({ length: 6 }, (_, i) => row(i)));
    mocks.verified.only = new Set(["hash0", "hash1", "hash2", "hash3"]);
    const get = async () => (await heldBy(new Request(`${URL_BASE}/held-by?base=MEM&aircraft=MD11&seat=CAP&month=OCT26`))).json();
    expect((await get()).holders).toEqual([]);
    mocks.verified.only.add("hash4");
    const holders = (await get()).holders as { lineNumber: string }[];
    expect(holders.map((h) => h.lineNumber)).toEqual(["1000", "1001", "1002", "1003", "1004"]);
  });

  it("a report with no tag can't be traced to a confirmed account, so it isn't counted", async () => {
    mocks.rows.mockResolvedValue([...Array.from({ length: 4 }, (_, i) => row(i)), row(4, { pilotHash: null })]);
    mocks.verified.only = new Set(["hash0", "hash1", "hash2", "hash3"]);
    expect((await (await GET(new Request(`${URL_BASE}?base=MEM&aircraft=MD11&seat=CAP`))).json()).totalReports).toBe(0);
  });
});

describe("withdrawing", () => {
  const del = (body: unknown) => DELETE(new Request(URL_BASE, { method: "DELETE", body: JSON.stringify(body) }));

  it("needs a signed-in pilot", async () => {
    expect((await del({})).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("removes one month by the pilot's own hash", async () => {
    mocks.user.mockResolvedValue(pilot);
    expect(await (await del({ base: "MEM", aircraft: "MD11", seat: "CAP", month: "OCT26" })).json()).toEqual({ removed: 3 });
    const [hash, packKey] = mocks.remove.mock.calls[0];
    expect(hash).toMatch(/^[0-9a-f]{20}$/);
    expect(hash).not.toContain(pilot.id);
    expect(packKey).toBe("oct26|mem|md11|cap");
  });

  it("removes everything when no month is named", async () => {
    mocks.user.mockResolvedValue(pilot);
    await del({});
    expect(mocks.remove.mock.calls[0][1]).toBeUndefined();
  });

  it("refuses half a month", async () => {
    mocks.user.mockResolvedValue(pilot);
    expect((await del({ month: "OCT26" })).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
