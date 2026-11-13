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
// The calendar link a reset revokes: in memory, never Postgres.
const feeds = vi.hoisted(() => ({ revoked: [] as string[] }));
vi.mock("@/lib/server/calendar-feeds", () => ({ revokeFeed: vi.fn(async (id: string) => void feeds.revoked.push(id)) }));
const mail = vi.hoisted(() => ({ configured: true, sent: [] as { to: string }[], delayMs: 0 }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => (mail.configured ? { apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" } : null),
  isEmailConfigured: () => mail.configured,
  // As slow as a real call to the mail provider, when a test asks.
  sendEmail: async (m: { to: string }) => {
    if (mail.delayMs) await new Promise((r) => setTimeout(r, mail.delayMs));
    mail.sent.push(m);
    return true;
  },
}));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
// The work after the answer, held until the test runs it.
const after = vi.hoisted(() => ({ pending: [] as (() => Promise<void>)[] }));
vi.mock("@/lib/server/after-response", () => ({ afterResponse: (work: () => Promise<void>) => void after.pending.push(work) }));
const accounts = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/server/db", () => ({
  findCredentialByEmail: async (email: string) => (accounts.has(email) ? { userId: "22222222-2222-4222-8222-222222222222", email, passwordHash: "00", salt: "00" } : null),
  saveResetToken: async () => {},
}));

const { POST } = await import("./route");
const { SITE_MAILS_PER_HOUR, SITE_MAILS_PER_SENDER_PER_HOUR } = await import("@/lib/server/mail-allowance");
const device = (n: number) => `ls_device=${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const ask = (email: string, ip = "203.0.113.1", cookie?: string) =>
  POST(new Request("https://example.com/api/auth/forgot", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ email }) }));
const runAfter = async () => {
  for (const work of after.pending.splice(0)) await work();
};
const hourKey = () => `line-select:reset-mail:${new Date().toISOString().slice(0, 13)}`;

beforeEach(() => {
  kv.clear();
  accounts.clear();
  mail.sent.length = 0;
  mail.configured = true;
  mail.delayMs = 0;
  after.pending.length = 0;
});

describe("POST /api/auth/forgot, across the whole site", () => {
  it("answers at once, the same way, before anything about the address is looked up or sent", async () => {
    accounts.add("has@example.com");
    mail.delayMs = 250;
    const time = async (email: string) => {
      const t = performance.now();
      const res = await ask(email, "198.51.100.7");
      return { ms: performance.now() - t, body: await res.text() };
    };
    const yes = await time("has@example.com");
    const no = await time("none@example.com");
    expect(yes.body).toBe(no.body);
    expect(Math.abs(yes.ms - no.ms)).toBeLessThan(100);
    expect(mail.sent).toHaveLength(0);
    await runAfter();
    expect(mail.sent.map((m) => m.to)).toEqual(["has@example.com"]);
  });

  it(`sends at most ${SITE_MAILS_PER_HOUR.reset} reset emails an hour, and answers the same past that`, async () => {
    for (let n = 0; n < 50; n++) accounts.add(`pilot${n}@example.com`);
    const answers = [];
    for (let n = 0; n < 50; n++) answers.push(await (await ask(`Pilot${n}@example.com `, `198.51.100.${n}`)).json());
    await runAfter();
    expect(mail.sent).toHaveLength(SITE_MAILS_PER_HOUR.reset);
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ emailEnabled: true })]));
  });

  it("doesn't count addresses with no account, which are never mailed", async () => {
    accounts.add("real@example.com");
    for (let n = 0; n < 50; n++) await ask(`nobody${n}@example.com`, `198.51.100.${n}`);
    await ask("real@example.com");
    await runAfter();
    expect(mail.sent.map((m) => m.to)).toEqual(["real@example.com"]);
    expect(kv.get(hourKey())).toBe(1);
  });

  it("one address takes only its small share of the hour, whatever it asks for, and other pilots still get theirs", async () => {
    for (let n = 0; n < 10; n++) accounts.add(`own${n}@attacker.example`);
    accounts.add("pilot@example.com");
    for (let i = 0; i < 30; i++) await ask(`own${i % 10}@attacker.example`, "198.51.100.7", device(i));
    await runAfter();
    expect(mail.sent).toHaveLength(SITE_MAILS_PER_SENDER_PER_HOUR);
    expect(kv.get(hourKey())).toBe(SITE_MAILS_PER_SENDER_PER_HOUR);
    await ask("pilot@example.com", "203.0.113.50", device(99));
    await runAfter();
    expect(mail.sent.some((m) => m.to === "pilot@example.com")).toBe(true);
  });

  it("still says when email isn't set up", async () => {
    mail.configured = false;
    expect(await (await ask("pilot@example.com")).json()).toEqual({ emailEnabled: false });
  });
});
