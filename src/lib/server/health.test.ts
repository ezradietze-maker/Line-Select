import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
let redisDown = false;
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => {
    if (redisDown) throw new Error("redis unreachable");
    return store.get(key) ?? null;
  },
  setJson: async (key: string, value: unknown) => {
    store.set(key, value);
  },
}));
let dbAnswers = true;
const dbCalls = { n: 0 };
vi.mock("@/lib/server/postgres", () => ({
  db: {
    execute: async () => {
      dbCalls.n++;
      if (!dbAnswers) throw new Error("connection refused");
      return { rows: [{ "?column?": 1 }] };
    },
  },
}));

const { checkHealth, DB_RECHECK_DOWN_SECONDS, DB_RECHECK_OK_SECONDS } = await import("./health");

const t0 = new Date("2026-11-26T12:00:00Z");
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

beforeEach(() => {
  store.clear();
  redisDown = false;
  dbAnswers = true;
  dbCalls.n = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the health check", () => {
  it("is ok while Redis and the database answer", async () => {
    expect(await checkHealth(t0)).toEqual({ ok: true, redis: "ok", database: "ok", databaseCheckedAt: t0.toISOString() });
  });

  it("asks the database at most once an hour while it's fine, however often it's checked", async () => {
    for (let s = 0; s < DB_RECHECK_OK_SECONDS; s += 60) await checkHealth(after(s));
    expect(dbCalls.n).toBe(1);
    await checkHealth(after(DB_RECHECK_OK_SECONDS));
    expect(dbCalls.n).toBe(2);
  });

  it("says the database is down, and asks again every five minutes until it's back", async () => {
    dbAnswers = false;
    expect(await checkHealth(t0)).toMatchObject({ ok: false, database: "down", redis: "ok" });
    await checkHealth(after(60));
    expect(dbCalls.n).toBe(1);
    dbAnswers = true;
    expect(await checkHealth(after(DB_RECHECK_DOWN_SECONDS))).toMatchObject({ ok: true, database: "ok" });
    expect(dbCalls.n).toBe(2);
  });

  it("says Redis is down when it doesn't answer, still checking the database", async () => {
    redisDown = true;
    expect(await checkHealth(after(10 * DB_RECHECK_OK_SECONDS))).toMatchObject({ ok: false, redis: "down", database: "ok" });
  });
});
