import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing up when email is set up, through the route and the real `auth.ts`: an address with a confirmed account, one
 * with an unconfirmed account and one with none get the very same answer, and what differs happens only after it, by
 * email. In-memory store, database and email: never Redis, Postgres or Resend.
 */

const kv = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/server/kv", () => ({
  getJson: async (k: string) => kv.get(k) ?? null,
  setJson: async () => {},
  incrementCounter: async (k: string) => {
    const n = (kv.get(k) ?? 0) + 1;
    kv.set(k, n);
    return n;
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// The calendar link a reset revokes: in memory, never Postgres.
const feeds = vi.hoisted(() => ({ revoked: [] as string[] }));
vi.mock("@/lib/server/calendar-feeds", () => ({ revokeFeed: vi.fn(async (id: string) => void feeds.revoked.push(id)) }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => ({ apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" }),
  isEmailConfigured: () => true,
  sendEmail: async (m: { to: string; subject: string; text: string }) => (mail.sent.push(m), true),
}));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
// The work after the answer, held until the test runs it: what was looked up before answering is then plain to see.
const after = vi.hoisted(() => ({ pending: [] as (() => Promise<void>)[] }));
vi.mock("@/lib/server/after-response", () => ({ afterResponse: (work: () => Promise<void>) => void after.pending.push(work) }));

const accounts = vi.hoisted(() => ({
  users: [] as { id: string; email: string; displayName: string; createdAt: string; plan: "free"; emailVerified: boolean }[],
  lookups: 0,
}));
vi.mock("@/lib/server/db", () => ({
  findUserByEmail: async (email: string) => (accounts.lookups++, accounts.users.find((u) => u.email === email) ?? null),
  createUserWithCredential: async (user: (typeof accounts.users)[number]) => (accounts.users.push({ ...user, emailVerified: false }), { ok: true }),
  saveVerificationToken: async () => {},
  saveResetToken: async () => {},
}));

const { POST } = await import("./route");

let address = 0;
const signUp = (email: string) =>
  POST(
    new Request("https://app.example.com/api/auth/signup", {
      method: "POST",
      headers: { "x-forwarded-for": `198.51.100.${++address}`, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "a long enough password", displayName: "J. Pilot" }),
    })
  );
const runAfter = async () => {
  for (const work of after.pending.splice(0)) await work();
};
const reply = async (res: Response) => ({ status: res.status, body: await res.text(), cookie: res.headers.get("set-cookie") });

beforeEach(() => {
  kv.clear();
  mail.sent.length = 0;
  after.pending.length = 0;
  accounts.lookups = 0;
  accounts.users = [
    { id: "11111111-1111-4111-8111-111111111111", email: "confirmed@example.com", displayName: "C", createdAt: "", plan: "free", emailVerified: true },
    { id: "22222222-2222-4222-8222-222222222222", email: "unconfirmed@example.com", displayName: "U", createdAt: "", plan: "free", emailVerified: false },
  ];
});

describe("sign-up's answer", () => {
  it("is the same for a new address, one with a confirmed account and one with an unconfirmed account", async () => {
    const answers = [await reply(await signUp("new@example.com")), await reply(await signUp("confirmed@example.com")), await reply(await signUp("unconfirmed@example.com"))];
    expect(answers[0]).toEqual({ status: 200, body: JSON.stringify({ checkEmail: true }), cookie: null });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // Nothing about any address was looked up before answering: that all waits for after the answer.
    expect(accounts.lookups).toBe(0);
    expect(after.pending).toHaveLength(3);
  });

  it("is followed by the email each address should get, and only a new address gets an account", async () => {
    await signUp("new@example.com");
    await signUp("confirmed@example.com");
    await signUp("unconfirmed@example.com");
    await runAfter();
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
      ["new@example.com", "Confirm your email for Line Select"],
      ["confirmed@example.com", "Someone tried to sign up for Line Select with your email"],
      ["unconfirmed@example.com", "Finish signing up for Line Select"],
    ]);
    expect(accounts.users.map((u) => u.email)).toEqual(["confirmed@example.com", "unconfirmed@example.com", "new@example.com"]);
    expect(accounts.users[2].emailVerified).toBe(false);
  });

  it("still says what's wrong with a field, the same whatever the address", async () => {
    const res = await POST(
      new Request("https://app.example.com/api/auth/signup", { method: "POST", headers: { "x-forwarded-for": "203.0.113.1" }, body: JSON.stringify({ email: "confirmed@example.com", password: "short", displayName: "J" }) })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Password must be at least 8 characters.");
    expect(after.pending).toHaveLength(0);
  });
});
