import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Send the link again" by address, signed out, through the real route and `auth.ts`: one answer, at once, for every
 * address; limited per sending address whatever the device. In-memory store, database and email.
 */
const kv = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/server/kv", () => ({
  getJson: async (k: string) => kv.get(k) ?? null,
  setJson: async (k: string, v: unknown) => void kv.set(k, v),
  incrementCounter: async (k: string) => {
    const n = ((kv.get(k) as number) ?? 0) + 1;
    kv.set(k, n);
    return n;
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/server/calendar-feeds", () => ({ revokeFeed: vi.fn(async () => {}) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string }[] }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => ({ apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" }),
  isEmailConfigured: () => true,
  // As slow as a real call to the mail provider.
  sendEmail: async (m: { to: string }) => {
    await new Promise((r) => setTimeout(r, 250));
    mail.sent.push(m);
    return true;
  },
}));
const after = vi.hoisted(() => ({ pending: [] as (() => Promise<void>)[] }));
vi.mock("@/lib/server/after-response", () => ({ afterResponse: (work: () => Promise<void>) => void after.pending.push(work) }));
type User = { id: string; email: string; displayName: string; createdAt: string; plan: "free"; emailVerified: boolean };
const users = vi.hoisted(() => [] as User[]);
vi.mock("@/lib/server/db", () => ({
  findSession: async () => null,
  findUserByEmail: async (email: string) => users.find((u) => u.email === email) ?? null,
  saveVerificationToken: async () => {},
}));

const { POST } = await import("./route");
const ask = (email: string, ip: string, device = randomUUID()) =>
  POST(new Request("https://app.example.com/api/auth/confirm-email/resend", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, cookie: `ls_device=${device}` }, body: JSON.stringify({ email }) }));
const add = (email: string, emailVerified: boolean) => users.push({ id: randomUUID(), email, displayName: "P", createdAt: "", plan: "free", emailVerified });

beforeEach(() => {
  kv.clear();
  mail.sent.length = 0;
  after.pending.length = 0;
  users.length = 0;
});

describe("Send the link again, by address", () => {
  it("answers at once and the same for an account waiting on its link, a confirmed one and none", async () => {
    add("waiting@example.com", false);
    add("confirmed@example.com", true);
    const replies = [];
    for (const email of ["waiting@example.com", "confirmed@example.com", "nobody@example.com"]) {
      const t = performance.now();
      const res = await ask(email, "198.51.100.8");
      replies.push({ ms: performance.now() - t, body: `${res.status} ${await res.text()}` });
    }
    expect(new Set(replies.map((r) => r.body)).size).toBe(1);
    expect(Math.max(...replies.map((r) => r.ms)) - Math.min(...replies.map((r) => r.ms))).toBeLessThan(100);
    expect(mail.sent).toHaveLength(0);
    for (const work of after.pending.splice(0)) await work();
    expect(mail.sent.map((m) => m.to)).toEqual(["waiting@example.com"]);
  });

  it("is limited per sending address, however many device cookies it brings", async () => {
    const statuses = [];
    for (let i = 0; i < 14; i++) statuses.push((await ask("nobody@example.com", "203.0.113.66")).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.at(-1)).toBe(429);
  });
});
