import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/**
 * Against a real Postgres (TEST_DATABASE_URL only, as `db.test.ts`; skipped without one): an owner taking their account
 * back by an emailed reset ends a calendar link someone else made while they were in. kv and email in memory.
 */
const hasDb = vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  return !!process.env.TEST_DATABASE_URL;
});
const kv = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (k: string) => kv.get(k) ?? null),
  setJson: vi.fn(async (k: string, v: unknown) => void kv.set(k, v)),
  incrementCounter: vi.fn(async (k: string) => {
    const n = ((kv.get(k) as number) ?? 0) + 1;
    kv.set(k, n);
    return n;
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; text: string }[] }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => ({ apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" }),
  isEmailConfigured: () => true,
  sendEmail: vi.fn(async (m: { to: string; text: string }) => (mail.sent.push(m), true)),
}));

describe.skipIf(!hasDb)("someone else's way into an account after the owner's emailed reset", () => {
  it("a calendar link made by whoever was signed in stops working when the owner resets", async () => {
    const auth = await import("@/lib/server/auth");
    const db = await import("@/lib/server/db");
    const feeds = await import("@/lib/server/calendar-feeds");
    const email = `owner-${randomUUID().slice(0, 8)}@test.line-select.invalid`;
    const id = randomUUID();
    await db.createUserWithCredential({ id, email, displayName: "Owner", createdAt: new Date().toISOString(), plan: "free", emailVerified: false }, { userId: id, email, passwordHash: "00", salt: "00" });
    try {
      const { token } = await feeds.startFeed(id);
      expect(await feeds.feedForToken(token)).not.toBeNull();
      await auth.requestPasswordResetEmail(email, "198.51.100.1", null);
      const link = mail.sent.at(-1)!.text.match(/token=([0-9a-f]+)/)![1];
      expect((await auth.resetPasswordWithEmailToken(link, "owner's new password", "198.51.100.1", null)).ok).toBe(true);
      expect(await feeds.feedForToken(token)).toBeNull();
    } finally {
      const { db: pg } = await import("@/lib/server/postgres");
      const { users } = await import("@/lib/server/schema");
      const { eq } = await import("drizzle-orm");
      await pg.delete(users).where(eq(users.id, id));
    }
  });
});
