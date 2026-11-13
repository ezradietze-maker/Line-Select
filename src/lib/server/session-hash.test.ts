import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sessions as `db.ts` stores and finds them, against an in-memory table: the query builder is stood in for, and
 * `eq` made plain, so no database is touched.
 */
type Row = { token: string; userId: string; expiresAt: Date };
const table = vi.hoisted(() => ({ rows: [] as Row[] }));

const field = (column: { name: string }) => ({ expires_at: "expiresAt", user_id: "userId" })[column.name] ?? column.name;
type Where = (row: Record<string, unknown>) => boolean;
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: { name: string }, value: unknown): Where => (row) => row[field(column)] === value,
  lte: (column: { name: string }, value: Date): Where => (row) => (row[field(column)] as Date) <= value,
  and: (...wheres: Where[]): Where => (row) => wheres.every((w) => w(row)),
  inArray: (column: { name: string }, values: unknown[]): Where => (row) => values.includes(row[field(column)]),
}));

vi.mock("@/lib/server/postgres", () => {
  const matching = (where: (row: Row) => boolean) => table.rows.filter(where);
  return {
    db: {
      select: () => ({ from: () => ({ where: (where: (row: Row) => boolean) => ({ limit: async (n: number) => matching(where).slice(0, n) }) }) }),
      insert: () => ({ values: async (row: Row) => void table.rows.push(row) }),
      update: () => ({ set: (patch: Partial<Row>) => ({ where: async (where: (row: Row) => boolean) => matching(where).forEach((r) => Object.assign(r, patch)) }) }),
      delete: () => ({ where: async (where: (row: Row) => boolean) => void (table.rows = table.rows.filter((r) => !where(r))) }),
    },
  };
});

const { createSession, deleteSession, findSession } = await import("@/lib/server/db");

const USER = "11111111-1111-4111-8111-111111111111";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const newToken = () => randomBytes(32).toString("hex");

beforeEach(() => {
  table.rows = [];
});

describe("session cookies", () => {
  it("stores only the token's hash, and finds the session by the token", async () => {
    const token = newToken();
    await createSession({ token, userId: USER, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(table.rows[0].token).toBe(sha256(token));
    expect((await findSession(token))?.userId).toBe(USER);
  });

  it("a hash copied out of the table doesn't work as a cookie, even for a row from before hashing", async () => {
    // A row rewritten from before 6 Nov kept its old expiry, inside the window the old lookup by raw value covered.
    const token = newToken();
    table.rows.push({ token: sha256(token), userId: USER, expiresAt: new Date("2026-12-01T00:00:00Z") });
    vi.useFakeTimers({ now: new Date("2026-11-12T12:00:00Z") });
    try {
      expect(await findSession(sha256(token))).toBeNull();
      expect((await findSession(token))?.userId).toBe(USER);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signing out with a copied hash leaves the pilot signed in", async () => {
    const token = newToken();
    await createSession({ token, userId: USER, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await deleteSession(sha256(token));
    expect(table.rows).toHaveLength(1);
    await deleteSession(token);
    expect(table.rows).toHaveLength(0);
  });

  it("drops an expired session", async () => {
    const token = newToken();
    await createSession({ token, userId: USER, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await findSession(token)).toBeNull();
    expect(table.rows).toHaveLength(0);
  });
});
