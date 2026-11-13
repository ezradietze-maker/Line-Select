import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confirming a pilot's address, end to end through the real `auth.ts`: signing up when email is set up, the link, and
 * "Send it again". The database, the store and email are in memory here: never Postgres, Redis or Resend.
 */

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

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], configured: true }));
vi.mock("@/lib/server/email", () => ({
  getEmailConfig: () => (mail.configured ? { apiKey: "k", from: "Line Select <a@b.c>", appUrl: "https://app.example.com" } : null),
  isEmailConfigured: () => mail.configured,
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => (mail.sent.push(m), true)),
}));

type User = { id: string; email: string; displayName: string; createdAt: string; plan: "free"; emailVerified?: boolean };
type Token = { tokenHash: string; userId: string; expiresAt: string; usedAt?: string; signUp: boolean; deviceHash: string | null };
const store = vi.hoisted(() => ({
  users: [] as User[],
  credentials: [] as { userId: string; email: string; passwordHash: string; salt: string; recoveryHash?: string; recoverySalt?: string }[],
  sessions: [] as { token: string; userId: string }[],
  confirmTokens: [] as Token[],
  resetTokens: [] as { tokenHash: string; userId: string; expiresAt: string }[],
}));
vi.mock("@/lib/server/db", () => ({
  createUserWithCredential: vi.fn(async (user: User, credential: (typeof store.credentials)[number]) => {
    if (store.users.some((u) => u.email === user.email)) return { ok: false, reason: "duplicate-email" };
    store.users.push({ ...user });
    store.credentials.push({ ...credential });
    return { ok: true };
  }),
  createSession: vi.fn(async (s: { token: string; userId: string }) => void store.sessions.push(s)),
  deleteSession: vi.fn(async () => {}),
  deleteSessionsForUser: vi.fn(async (id: string) => void (store.sessions = store.sessions.filter((s) => s.userId !== id))),
  findCredentialByEmail: vi.fn(async (email: string) => store.credentials.find((c) => c.email === email) ?? null),
  findCredentialByUserId: vi.fn(async (id: string) => store.credentials.find((c) => c.userId === id) ?? null),
  findSession: vi.fn(),
  findUserByEmail: vi.fn(async (email: string) => store.users.find((u) => u.email === email) ?? null),
  findUserById: vi.fn(async (id: string) => store.users.find((u) => u.id === id) ?? null),
  updateCredential: vi.fn(async (id: string, patch: object) => {
    const c = store.credentials.find((x) => x.userId === id);
    if (c) Object.assign(c, patch);
  }),
  saveResetToken: vi.fn(async (t: (typeof store.resetTokens)[number]) => {
    store.resetTokens = [...store.resetTokens.filter((x) => x.userId !== t.userId), t];
  }),
  consumeResetToken: vi.fn(async (hash: string) => {
    const t = store.resetTokens.find((x) => x.tokenHash === hash);
    store.resetTokens = store.resetTokens.filter((x) => x.tokenHash !== hash);
    return t && Date.parse(t.expiresAt) > Date.now() ? t.userId : null;
  }),
  markEmailVerified: vi.fn(async (id: string) => {
    const u = store.users.find((x) => x.id === id);
    if (u) u.emailVerified = true;
  }),
  // As the real one: one per pilot, a new one replaces the last but keeps whether signing up sent the first.
  saveVerificationToken: vi.fn(async (t: Omit<Token, "usedAt" | "signUp" | "deviceHash"> & { signUp?: boolean; deviceHash?: string | null }) => {
    const old = store.confirmTokens.find((x) => x.userId === t.userId);
    store.confirmTokens = [...store.confirmTokens.filter((x) => x.userId !== t.userId), { ...t, signUp: old ? old.signUp : !!t.signUp, deviceHash: t.deviceHash ?? null }];
  }),
  spendVerificationToken: vi.fn(async (hash: string) => {
    const t = store.confirmTokens.find((x) => x.tokenHash === hash);
    if (!t) return { status: "invalid" };
    if (t.usedAt) return { status: "used", userId: t.userId };
    if (Date.parse(t.expiresAt) <= Date.now()) return { status: "expired" };
    t.usedAt = new Date().toISOString();
    const u = store.users.find((x) => x.id === t.userId);
    if (u) u.emailVerified = true;
    return { status: "confirmed", userId: t.userId, deviceHash: t.deviceHash };
  }),
}));

const { confirmEmail, login, resendConfirmEmail, resetPasswordWithEmailToken, signUpByEmail, RESENDS_PER_ACCOUNT, RESENDS_PER_ADDRESS } = await import("@/lib/server/auth");

const LAPTOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const linkIn = (text: string | undefined, page: string) => text?.match(new RegExp(`${page}\\?token=([0-9a-f]+)`))?.[1] ?? null;
const lastConfirmLink = () => linkIn(mail.sent.at(-1)?.text, "confirm-email");

beforeEach(() => {
  kv.clear();
  mail.sent.length = 0;
  mail.configured = true;
  store.users = [];
  store.credentials = [];
  store.sessions = [];
  store.confirmTokens = [];
  store.resetTokens = [];
});

describe("signing up with email set up", () => {
  it("makes an unconfirmed account with no session and no recovery code yet, and mails a 24-hour link", async () => {
    await signUpByEmail("New@Example.com ", "a long password", "J. Pilot", LAPTOP);
    expect(store.users).toEqual([expect.objectContaining({ email: "new@example.com", emailVerified: false })]);
    expect(store.sessions).toHaveLength(0);
    expect(store.credentials[0].recoveryHash).toBeUndefined();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "new@example.com", subject: "Confirm your email for Line Select" });
    const token = lastConfirmLink()!;
    expect(mail.sent[0].text).toContain(`https://app.example.com/confirm-email?token=${token}`);
    // Only its hash is kept.
    expect(JSON.stringify(store.confirmTokens)).not.toContain(token);
    expect(Date.parse(store.confirmTokens[0].expiresAt) - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    expect(store.confirmTokens[0].signUp).toBe(true);
  });

  it("changes nothing for an address with a confirmed account, and tells its owner", async () => {
    await signUpByEmail("owner@example.com", "the owners password", "Owner", LAPTOP);
    store.users[0].emailVerified = true;
    const before = JSON.stringify(store);
    mail.sent.length = 0;
    await signUpByEmail("owner@example.com", "someone elses pw", "Someone Else", PHONE);
    expect(JSON.stringify(store)).toBe(before);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("Someone tried to sign up for Line Select with your email");
    expect(mail.sent[0].text).toContain("https://app.example.com/auth");
    expect(mail.sent[0].text).not.toMatch(/token=/);
  });

  it("lets the real owner take an unconfirmed account someone else started with their address", async () => {
    // Someone else signs up with the pilot's address, signs in with their own password, and makes a recovery code.
    await signUpByEmail("pilot@example.com", "the squatters pw", "Not The Pilot", PHONE);
    expect((await login("pilot@example.com", "the squatters pw")).ok).toBe(true);
    store.credentials[0].recoveryHash = "made-by-someone-else";
    mail.sent.length = 0;
    // The pilot signs up with their own address: they get a link that resets the account.
    await signUpByEmail("pilot@example.com", "the pilots own pw", "The Pilot", LAPTOP);
    expect(store.users).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("Finish signing up for Line Select");
    const reset = linkIn(mail.sent[0].text, "reset-password")!;
    expect(reset).toBeTruthy();
    const taken = await resetPasswordWithEmailToken(reset, "the pilots own pw");
    expect(taken.ok).toBe(true);
    expect(taken.user?.emailVerified).toBe(true);
    // The other person is signed out, their password and recovery code are gone.
    expect(store.sessions.map((s) => s.token)).toEqual([taken.sessionToken]);
    expect((await login("pilot@example.com", "the squatters pw")).ok).toBe(false);
    expect(store.credentials[0].recoveryHash).not.toBe("made-by-someone-else");
    expect(taken.recoveryCode).toBeTruthy();
  });

  it("sends one address no more than five emails an hour, however many sign-ups name it", async () => {
    for (let i = 0; i < 8; i++) await signUpByEmail("busy@example.com", "a long password", "J. Pilot", LAPTOP);
    expect(mail.sent).toHaveLength(5);
  });

  it("counts every sign-up email against the site's hourly allowance", async () => {
    for (let i = 0; i < 45; i++) await signUpByEmail(`pilot${i}@example.com`, "a long password", "J. Pilot", LAPTOP);
    expect(mail.sent).toHaveLength(40);
  });
});

describe("opening the confirm link", () => {
  async function signedUp(email = "new@example.com", device = LAPTOP) {
    await signUpByEmail(email, "a long password", "J. Pilot", device);
    return { token: lastConfirmLink()!, user: store.users.find((u) => u.email === email)! };
  }

  it("a good link confirms the account and, on the device that signed up, signs it in with a new recovery code", async () => {
    const { token, user } = await signedUp();
    const result = await confirmEmail(token, null, LAPTOP);
    expect(result).toMatchObject({ status: "confirmed", signedIn: "now", user: { id: user.id, emailVerified: true } });
    expect(result.status === "confirmed" && result.sessionToken).toBeTruthy();
    expect(result.status === "confirmed" && result.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
    expect(store.users[0].emailVerified).toBe(true);
  });

  it("keeps its own pilot signed in as they were", async () => {
    const { token, user } = await signedUp();
    const result = await confirmEmail(token, user.id, PHONE);
    expect(result).toMatchObject({ status: "confirmed", signedIn: "already" });
    expect(store.sessions).toHaveLength(0);
  });

  it("on another device, confirms but signs no one in: a passed-on link can't sign someone in to its sender's account", async () => {
    const { token } = await signedUp();
    const result = await confirmEmail(token, null, PHONE);
    expect(result).toMatchObject({ status: "confirmed", signedIn: "no" });
    expect(result.status === "confirmed" && (result.sessionToken ?? result.recoveryCode)).toBeFalsy();
    expect(store.sessions).toHaveLength(0);
    expect(store.users[0].emailVerified).toBe(true);
  });

  it("someone else's link confirms that account only, and leaves this device signed in as itself", async () => {
    const mine = await signedUp("mine@example.com");
    const theirs = await signedUp("theirs@example.com");
    const result = await confirmEmail(theirs.token, mine.user.id, LAPTOP);
    expect(result).toMatchObject({ status: "confirmed", signedIn: "other-account" });
    expect(result.status === "confirmed" && (result.sessionToken ?? result.recoveryCode)).toBeFalsy();
    expect(store.users.find((u) => u.email === "mine@example.com")!.emailVerified).toBe(false);
    expect(store.users.find((u) => u.email === "theirs@example.com")!.emailVerified).toBe(true);
  });

  it("an expired link confirms nothing", async () => {
    const { token } = await signedUp();
    store.confirmTokens[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await confirmEmail(token, null, LAPTOP)).toEqual({ status: "expired" });
    expect(store.users[0].emailVerified).toBe(false);
    expect(store.sessions).toHaveLength(0);
  });

  it("works once: a second open says it's used and signs no one in", async () => {
    const { token, user } = await signedUp();
    await confirmEmail(token, null, LAPTOP);
    store.sessions = [];
    expect(await confirmEmail(token, null, LAPTOP)).toEqual({ status: "used", yours: false });
    expect(await confirmEmail(token, user.id, LAPTOP)).toEqual({ status: "used", yours: true });
    expect(store.sessions).toHaveLength(0);
  });

  it("a made-up link is no link", async () => {
    await signedUp();
    expect(await confirmEmail("deadbeef", null, LAPTOP)).toEqual({ status: "invalid" });
  });

  it("a newer link replaces the older one", async () => {
    const { token: first, user } = await signedUp();
    expect((await resendConfirmEmail(user, "203.0.113.5", LAPTOP)).sent).toBe(true);
    expect(await confirmEmail(first, null, LAPTOP)).toEqual({ status: "invalid" });
    expect((await confirmEmail(lastConfirmLink()!, null, LAPTOP)).status).toBe("confirmed");
  });
});

describe("Send it again", () => {
  const legacy: User = { id: "11111111-1111-4111-8111-111111111111", email: "old@example.com", displayName: "Old", createdAt: "", plan: "free", emailVerified: false };

  it(`sends ${RESENDS_PER_ACCOUNT} an hour for one account`, async () => {
    const results = [];
    for (let i = 0; i < RESENDS_PER_ACCOUNT + 2; i++) results.push(await resendConfirmEmail(legacy, `203.0.113.${i}`, LAPTOP));
    expect(results.filter((r) => r.sent)).toHaveLength(RESENDS_PER_ACCOUNT);
    expect(results.at(-1)).toEqual({ sent: false, reason: "limited" });
    expect(mail.sent).toHaveLength(RESENDS_PER_ACCOUNT);
    // A link sent this way, to an account from before confirming existed, never lets the daily run remove it.
    expect(store.confirmTokens[0].signUp).toBe(false);
  });

  it(`sends ${RESENDS_PER_ADDRESS} an hour from one address, across accounts`, async () => {
    let sent = 0;
    for (let i = 0; i < RESENDS_PER_ADDRESS + 3; i++) {
      const r = await resendConfirmEmail({ ...legacy, id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`, email: `p${i}@example.com` }, "198.51.100.9", LAPTOP);
      if (r.sent) sent++;
    }
    expect(sent).toBe(RESENDS_PER_ADDRESS);
  });

  it("sends nothing to a confirmed account, or when email isn't set up", async () => {
    expect(await resendConfirmEmail({ ...legacy, emailVerified: true }, "203.0.113.1", LAPTOP)).toEqual({ sent: false, reason: "confirmed" });
    mail.configured = false;
    expect(await resendConfirmEmail(legacy, "203.0.113.1", LAPTOP)).toEqual({ sent: false, reason: "not-set-up" });
    expect(mail.sent).toHaveLength(0);
  });

  it("keeps a sign-up's first link marked as one, so the daily run can still remove it", async () => {
    await signUpByEmail("new@example.com", "a long password", "J. Pilot", LAPTOP);
    await resendConfirmEmail(store.users[0], "203.0.113.1", LAPTOP);
    expect(store.confirmTokens[0].signUp).toBe(true);
  });
});
