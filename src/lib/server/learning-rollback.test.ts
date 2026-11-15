import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/**
 * Against a real Postgres (TEST_DATABASE_URL only, as `db.test.ts`; skipped without one): the owner's undo of a learned
 * model (`/api/admin/learning`). Each test keeps its versions under a kind of its own, so nothing else's are touched.
 * kv in memory.
 */
const hasDb = vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  return !!process.env.TEST_DATABASE_URL;
});
vi.mock("@/lib/server/kv", () => ({ getJson: vi.fn(async () => null), setJson: vi.fn(async () => {}) }));

describe.skipIf(!hasDb)("undoing a learned model", () => {
  it("never brings back a version the owner already undid", async () => {
    const { db } = await import("@/lib/server/postgres");
    const { learnedModels } = await import("@/lib/server/schema");
    const { and, eq } = await import("drizzle-orm");
    const store = await import("@/lib/server/learning-store");
    const kind = `test-undo-${randomUUID()}` as Parameters<typeof store.saveModel>[0]["kind"];
    const save = async (version: string) => {
      await store.saveModel({ kind, version, payload: {}, metrics: {}, sampleSize: 1, active: true });
      // Versions are told apart by when they were made.
      await new Promise((r) => setTimeout(r, 10));
    };
    try {
      await save("a");
      await save("b");
      // "b" turns out bad: back to "a".
      expect(await store.rollBackModel(kind)).toEqual({ from: "b", to: "a" });
      // The next run promotes "c", which is bad too: back to "a" again, not to "b".
      await save("c");
      expect(await store.rollBackModel(kind)).toEqual({ from: "c", to: "a" });
      const inUse = await db.select({ version: learnedModels.version }).from(learnedModels).where(and(eq(learnedModels.kind, kind), eq(learnedModels.active, true)));
      expect(inUse).toEqual([{ version: "a" }]);
      // Nothing older than "a" to go back to.
      expect(await store.rollBackModel(kind)).toBeNull();
    } finally {
      await db.delete(learnedModels).where(eq(learnedModels.kind, kind));
    }
  });
});
