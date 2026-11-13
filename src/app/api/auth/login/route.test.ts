import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-up answers the same for every address; signing in straight after, with the password just chosen, must too. Real
 * routes and `auth.ts`; in-memory store, database and email: never Redis, Postgres or Resend.
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
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => ({ apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" }),
  isEmailConfigured: () => true,
  sendEmail: async (m: { to: string; subject: string; text: string }) => (mail.sent.push(m), true),
}));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
const after = vi.hoisted(() => ({ pending: [] as (() => Promise<void>)[] }));
vi.mock("@/lib/server/after-response", () => ({ afterResponse: (work: () => Promise<void>) => void after.pending.push(work) }));

type User = { id: string; email: string; displayName: string; createdAt: string; plan: "free"; emailVerified?: boolean };
const store = vi.hoisted(() => ({
  users: [] as User[],
  credentials: [] as { userId: string; email: string; passwordHash: string; salt: string }[],
  sessions: [] as { token: string; userId: string }[],
  signUpLinks: new Set<string>(),
}));
vi.mock("@/lib/server/db", () => ({
  findUserByEmail: async (email: string) => store.users.find((u) => u.email === email) ?? null,
  findUserById: async (id: string) => store.users.find((u) => u.id === id) ?? null,
  findCredentialByEmail: async (email: string) => store.credentials.find((c) => c.email === email) ?? null,
  createUserWithCredential: async (user: User, c: (typeof store.credentials)[number]) => {
    if (store.users.some((u) => u.email === user.email)) return { ok: false };
    store.users.push({ ...user, emailVerified: false });
    store.credentials.push(c);
    return { ok: true };
  },
  createSession: async (s: { token: string; userId: string }) => void store.sessions.push(s),
  saveVerificationToken: async (t: { userId: string; signUp?: boolean }) => void (t.signUp && store.signUpLinks.add(t.userId)),
  saveResetToken: async () => {},
  updateCredential: async () => {},
  isUnconfirmedSignUp: async (id: string) => store.signUpLinks.has(id) && !store.users.find((u) => u.id === id)?.emailVerified,
}));

const signupRoute = await import("@/app/api/auth/signup/route");
const loginRoute = await import("./route");
const { LOGIN_FAILED } = await import("@/lib/server/auth");
const { scrypt, randomBytes } = await import("node:crypto");

const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, body: object, ip = "198.51.100.7") =>
  route.POST(new Request(`https://app.example.com${path}`, { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify(body) }));
const runAfter = async () => {
  for (const w of after.pending.splice(0)) await w();
};
const hashOf = (pw: string, salt: string) => new Promise<string>((ok) => scrypt(pw, salt, 64, (_, k) => ok(k.toString("hex"))));

beforeEach(async () => {
  kv.clear();
  mail.sent.length = 0;
  store.users = [];
  store.credentials = [];
  store.sessions = [];
  store.signUpLinks.clear();
  // A real pilot's confirmed account, password unknown to whoever is probing.
  const salt = randomBytes(16).toString("hex");
  store.users.push({ id: "11111111-1111-4111-8111-111111111111", email: "known@example.com", displayName: "Real", createdAt: "", plan: "free", emailVerified: true });
  store.credentials.push({ userId: "11111111-1111-4111-8111-111111111111", email: "known@example.com", passwordHash: await hashOf("pilots secret pw", salt), salt });
});

describe("sign-up's identical reply, then sign-in with the same password", () => {
  it("says the same for an address with an account as for one without", async () => {
    const probe = async (email: string) => {
      const s = await post(signupRoute, "/api/auth/signup", { email, password: "attacker pw 123", displayName: "X" });
      const signupReply = `${s.status} ${await s.text()}`;
      await runAfter();
      const l = await post(loginRoute, "/api/auth/login", { email, password: "attacker pw 123" });
      return { signupReply, login: `${l.status} ${await l.text()}`, cookie: !!l.headers.get("set-cookie") };
    };
    const has = await probe("known@example.com");
    const hasNot = await probe("nobody@example.com");
    expect(has.signupReply).toBe(hasNot.signupReply);
    expect(hasNot).toEqual(has);
    expect(has.login).toBe(`401 ${JSON.stringify({ error: LOGIN_FAILED })}`);
    expect(has.cookie).toBe(false);
    expect(store.sessions).toHaveLength(0);
  });

  it("a confirmed account still signs in", async () => {
    const l = await post(loginRoute, "/api/auth/login", { email: "known@example.com", password: "pilots secret pw" }, "203.0.113.5");
    expect(l.status).toBe(200);
    expect(l.headers.get("set-cookie")).toBeTruthy();
  });
});
