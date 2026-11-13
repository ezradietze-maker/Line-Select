import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reset emails across the whole site, through the real route, `auth.ts` and limits. In-memory store, database and
 * email: never Redis, Postgres or Resend.
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
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
const mail = vi.hoisted(() => ({ configured: true, sent: [] as { to: string }[] }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => (mail.configured ? { apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" } : null),
  isEmailConfigured: () => mail.configured,
  sendEmail: async (m: { to: string }) => (mail.sent.push(m), true),
}));
const accounts = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/server/db", () => ({
  findCredentialByEmail: async (email: string) => (accounts.has(email) ? { userId: "22222222-2222-4222-8222-222222222222", email, passwordHash: "00", salt: "00" } : null),
  saveResetToken: async () => {},
}));

const { POST } = await import("./route");
const device = (n: number) => `ls_device=${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const ask = (email: string, ip = "203.0.113.1", cookie?: string) =>
  POST(new Request("https://example.com/api/auth/forgot", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ email }) }));
const hourKey = () => `line-select:reset-mail:${new Date().toISOString().slice(0, 13)}`;

beforeEach(() => {
  kv.clear();
  accounts.clear();
  mail.sent.length = 0;
  mail.configured = true;
});

describe("POST /api/auth/forgot, across the whole site", () => {
  it("sends at most 20 reset emails an hour, and answers the same past that", async () => {
    for (let n = 0; n < 30; n++) accounts.add(`pilot${n}@example.com`);
    const answers = [];
    for (let n = 0; n < 30; n++) answers.push(await (await ask(`Pilot${n}@example.com `, `198.51.100.${n}`)).json());
    expect(mail.sent).toHaveLength(20);
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ emailEnabled: true })]));
  });

  it("doesn't count addresses with no account, which are never mailed", async () => {
    accounts.add("real@example.com");
    for (let n = 0; n < 50; n++) await ask(`nobody${n}@example.com`, `198.51.100.${n}`);
    await ask("real@example.com");
    expect(mail.sent.map((m) => m.to)).toEqual(["real@example.com"]);
    expect(kv.get(hourKey())).toBe(1);
  });

  it("one address asking over and over for its own account takes from the hour only what it was sent", async () => {
    accounts.add("attacker-own@example.com");
    accounts.add("pilot@example.com");
    for (let i = 0; i < 20; i++) await ask("attacker-own@example.com", "198.51.100.7", device(Math.floor(i / 10)));
    // Its own limit per account and address sent 6; the other 14 never touched the site's hour.
    expect(mail.sent).toHaveLength(6);
    expect(kv.get(hourKey())).toBe(6);
    // Another pilot, on another address, still gets theirs.
    await ask("pilot@example.com", "203.0.113.50", device(99));
    expect(mail.sent.some((m) => m.to === "pilot@example.com")).toBe(true);
  });

  it("still says when email isn't set up", async () => {
    mail.configured = false;
    expect(await (await ask("pilot@example.com")).json()).toEqual({ emailEnabled: false });
  });
});
