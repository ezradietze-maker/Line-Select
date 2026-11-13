import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confirming a pilot's address, end to end through the real `auth.ts`: signing up when email is set up, the link, and
 * "Send it again". The database, the store and email are in memory here: never Postgres, Redis or Resend.
 */

// Several tests here loop 100+ real sign-ups, each a full scrypt password hash, to prove the hourly allowances hold.
// On a busy CI runner that can run past the default 5s, and a timed-out test's still-pending async writes then land
// in the next test's freshly-reset store and throw its counts off. A generous timeout keeps these deterministic
// (same reason the lockout test was given 30s in commit 14141f8).
vi.setConfig({ testTimeout: 30_000 });

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
// The calendar link a reset revokes: in memory, never Postgres.
const feeds = vi.hoisted(() => ({ revoked: [] as string[] }));
vi.mock("@/lib/server/calendar-feeds", () => ({ revokeFeed: vi.fn(async (id: string) => void feeds.revoked.push(id)) }));

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
  peekVerificationToken: vi.fn(async (hash: string) => {
    const t = store.confirmTokens.find((x) => x.tokenHash === hash);
    if (!t) return { status: "invalid" };
    if (t.usedAt) return { status: "used", userId: t.userId };
    if (Date.parse(t.expiresAt) <= Date.now()) return { status: "expired" };
    return { status: "valid", userId: t.userId, deviceHash: t.deviceHash };
  }),
  voidVerificationToken: vi.fn(async (hash: string) => {
    const t = store.confirmTokens.find((x) => x.tokenHash === hash && !x.usedAt && Date.parse(x.expiresAt) > Date.now());
    if (!t) return null;
    t.usedAt = new Date().toISOString();
    return t.userId;
  }),
  // As the real one: unconfirmed, and its first link was sent by signing up.
  isUnconfirmedSignUp: vi.fn(async (id: string) => !store.users.find((u) => u.id === id)?.emailVerified && store.confirmTokens.some((t) => t.userId === id && t.signUp)),
}));

const {
  confirmEmail,
  createRecoveryCodeForUser,
  login,
  LOGIN_FAILED,
  requestPasswordResetEmail,
  resendConfirmEmail,
  resendConfirmEmailByAddress,
  resetPasswordWithEmailToken,
  resetPasswordWithRecoveryCode,
  signUpByEmail,
  RESENDS_PER_ACCOUNT,
  RESENDS_PER_ADDRESS,
} = await import("@/lib/server/auth");
const { SITE_MAILS_PER_HOUR, SITE_MAILS_PER_SENDER_PER_HOUR } = await import("@/lib/server/mail-allowance");

const LAPTOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SQUATTER_IP = "198.51.100.9";
const linkIn = (text: string | undefined, page: string) => text?.match(new RegExp(`${page}\\?token=([0-9a-f]+)`))?.[1] ?? null;
const lastConfirmLink = () => linkIn(mail.sent.at(-1)?.text, "confirm-email");
const lastResetLink = () => linkIn(mail.sent.at(-1)?.text, "reset-password");
/** An account from before confirming existed: no sign-up link, signs in with its password. */
const legacy = (over: Partial<User> = {}): User => ({ id: "11111111-1111-4111-8111-111111111111", email: "old@example.com", displayName: "Old", createdAt: "", plan: "free", emailVerified: false, ...over });

beforeEach(() => {
  kv.clear();
  mail.sent.length = 0;
  mail.configured = true;
  store.users = [];
  store.credentials = [];
  store.sessions = [];
  store.confirmTokens = [];
  store.resetTokens = [];
  feeds.revoked.length = 0;
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
    await signUpByEmail("owner@example.com", "someone elses pw", "Someone Else", PHONE, "203.0.113.2");
    expect(JSON.stringify(store)).toBe(before);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("Someone tried to sign up for Line Select with your email");
    expect(mail.sent[0].text).toContain("https://app.example.com/auth");
    expect(mail.sent[0].text).not.toMatch(/token=/);
  });

  it("can't be signed in to until it's confirmed, with the wrong password's own words: signing in after signing up says nothing", async () => {
    await signUpByEmail("new@example.com", "a long password", "J. Pilot", LAPTOP);
    const right = await login("new@example.com", "a long password", SQUATTER_IP, LAPTOP);
    const wrong = await login("new@example.com", "not the password", SQUATTER_IP, LAPTOP);
    const nobody = await login("nobody@example.com", "a long password", SQUATTER_IP, LAPTOP);
    expect(right).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(wrong).toEqual(right);
    expect(nobody).toEqual(right);
    expect(store.sessions).toHaveLength(0);
    // Once confirmed, the same password signs in.
    await confirmEmail(lastConfirmLink()!, null, LAPTOP, { password: "a long password" }, "203.0.113.5");
    expect((await login("new@example.com", "a long password", "203.0.113.5", LAPTOP)).ok).toBe(true);
  });

  it("an account from before confirming existed still signs in unconfirmed", async () => {
    store.users.push(legacy());
    await createLegacyPassword("old@example.com", "an old password");
    expect((await login("old@example.com", "an old password", "203.0.113.5")).ok).toBe(true);
  });

  it("lets the real owner take an unconfirmed account someone else started with their address", async () => {
    await signUpByEmail("pilot@example.com", "the squatters pw", "Not The Pilot", PHONE, SQUATTER_IP);
    mail.sent.length = 0;
    await signUpByEmail("pilot@example.com", "the pilots own pw", "The Pilot", LAPTOP, "203.0.113.50");
    expect(store.users).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe("Finish signing up for Line Select");
    const taken = await resetPasswordWithEmailToken(lastResetLink()!, "the pilots own pw");
    expect(taken.ok).toBe(true);
    expect(taken.user?.emailVerified).toBe(true);
    expect(taken.recoveryCode).toBeTruthy();
    expect((await login("pilot@example.com", "the squatters pw", SQUATTER_IP)).ok).toBe(false);
  });

  it("sends one address five emails an hour from one sender, so one sender can't stop anyone else's", async () => {
    for (let i = 0; i < 8; i++) await signUpByEmail("busy@example.com", "a long password", "J. Pilot", LAPTOP, SQUATTER_IP);
    expect(mail.sent).toHaveLength(5);
    // The address's owner, elsewhere, still gets theirs.
    await signUpByEmail("busy@example.com", "a long password", "J. Pilot", PHONE, "203.0.113.50");
    expect(mail.sent).toHaveLength(6);
  });

  it("sends one address ten an hour from everyone together", async () => {
    for (let i = 0; i < 15; i++) await signUpByEmail("busy@example.com", "a long password", "J. Pilot", LAPTOP, `198.51.100.${i}`);
    expect(mail.sent).toHaveLength(10);
  });

  it("past the site's hourly allowance makes no account, and sends nothing", async () => {
    for (let i = 0; i < 105; i++) await signUpByEmail(`pilot${i}@example.com`, "a long password", "J. Pilot", LAPTOP, `10.0.${Math.floor(i / 200)}.${i % 200}`);
    expect(mail.sent).toHaveLength(SITE_MAILS_PER_HOUR["sign-up"]);
    expect(store.users).toHaveLength(SITE_MAILS_PER_HOUR["sign-up"]);
  });

  it("one sender gets only a small share of the site's hour, across every address it names", async () => {
    for (let i = 0; i < 8; i++) await signUpByEmail(`pilot${i}@example.com`, "a long password", "J. Pilot", LAPTOP, SQUATTER_IP);
    expect(mail.sent).toHaveLength(SITE_MAILS_PER_SENDER_PER_HOUR);
    expect(store.users).toHaveLength(SITE_MAILS_PER_SENDER_PER_HOUR);
  });

  it("a sender over their own limit doesn't use the site's allowance", async () => {
    for (let i = 0; i < 60; i++) await signUpByEmail("same@example.com", "a long password", "J. Pilot", LAPTOP, SQUATTER_IP);
    expect(kv.get(`line-select:sign-up-mail:${new Date().toISOString().slice(0, 13)}`)).toBe(5);
  });
});

/** Sets a password the way sign-up does, for an account the test made by hand. */
async function createLegacyPassword(email: string, password: string) {
  const { scrypt } = await import("node:crypto");
  const salt = "legacy-salt";
  const passwordHash = await new Promise<string>((ok) => scrypt(password, salt, 64, (_e, k) => ok(k.toString("hex"))));
  const user = store.users.find((u) => u.email === email)!;
  store.credentials.push({ userId: user.id, email, passwordHash, salt });
}

describe("opening the confirm link", () => {
  async function signedUp(email = "new@example.com", device = LAPTOP) {
    await signUpByEmail(email, "a long password", "J. Pilot", device, `203.0.113.${store.users.length + 1}`);
    return { token: lastConfirmLink()!, user: store.users.find((u) => u.email === email)! };
  }

  it("asks for the password even on the device that signed up, then confirms, signs in and makes the recovery code", async () => {
    const { token, user } = await signedUp();
    expect(await confirmEmail(token, null, LAPTOP)).toEqual({ status: "needs-password", email: "new@example.com" });
    const result = await confirmEmail(token, null, LAPTOP, { password: "a long password" }, "203.0.113.1");
    expect(result).toMatchObject({ status: "confirmed", signedIn: "now", user: { id: user.id, emailVerified: true } });
    expect(result.status === "confirmed" && result.sessionToken).toBeTruthy();
    expect(result.status === "confirmed" && result.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
    expect(store.users[0].emailVerified).toBe(true);
  });

  it("anywhere else asks for the account's password first, and confirms nothing until it's right", async () => {
    const { token } = await signedUp();
    expect(await confirmEmail(token, null, PHONE)).toEqual({ status: "needs-password", email: "new@example.com" });
    expect(await confirmEmail(token, null, PHONE, { password: "a wrong one" }, "203.0.113.50")).toEqual({ status: "wrong-password" });
    expect(store.users[0].emailVerified).toBe(false);
    expect(store.confirmTokens[0].usedAt).toBeUndefined();
    const result = await confirmEmail(token, null, PHONE, { password: "a long password" }, "203.0.113.50");
    expect(result).toMatchObject({ status: "confirmed", signedIn: "now" });
    expect(store.users[0].emailVerified).toBe(true);
  });

  it("limits password tries there like a sign-in", async () => {
    const { token } = await signedUp();
    for (let i = 0; i < 6; i++) await confirmEmail(token, null, PHONE, { password: "guess" }, "198.51.100.77");
    expect(await confirmEmail(token, null, PHONE, { password: "a long password" }, "198.51.100.77")).toEqual({ status: "limited" });
    expect(store.users[0].emailVerified).toBe(false);
  });

  it("keeps its own pilot signed in as they were (an older account asking for a link)", async () => {
    store.users.push(legacy());
    await createLegacyPassword("old@example.com", "an old password");
    await resendConfirmEmail(store.users[0], "203.0.113.5", LAPTOP);
    const result = await confirmEmail(lastConfirmLink()!, store.users[0].id, PHONE);
    expect(result).toMatchObject({ status: "confirmed", signedIn: "already" });
    expect(store.sessions).toHaveLength(0);
  });

  it("someone else's link wants that account's password too, and then leaves this device signed in as itself", async () => {
    const mine = await signedUp("mine@example.com");
    const theirs = await signedUp("theirs@example.com");
    expect((await confirmEmail(theirs.token, mine.user.id, LAPTOP)).status).toBe("needs-password");
    expect(store.users.find((u) => u.email === "theirs@example.com")!.emailVerified).toBe(false);
    const result = await confirmEmail(theirs.token, mine.user.id, LAPTOP, { password: "a long password" }, "203.0.113.9");
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
    await confirmEmail(token, null, LAPTOP, { password: "a long password" }, "203.0.113.1");
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
    expect((await confirmEmail(lastConfirmLink()!, null, LAPTOP, { password: "a long password" }, "203.0.113.1")).status).toBe("confirmed");
  });
});

describe("a shared computer (crew room, hotel business centre)", () => {
  const CREW_ROOM_PC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ATTACKER_HOME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("someone signs up there with a pilot's address; the pilot opening the link there is asked for the password, so nothing is confirmed", async () => {
    await signUpByEmail("victim@fedex.example", "squatter's password", "Victim", CREW_ROOM_PC, "203.0.113.20");
    const r = await confirmEmail(lastConfirmLink()!, null, CREW_ROOM_PC, {}, "203.0.113.20");
    expect(r).toEqual({ status: "needs-password", email: "victim@fedex.example" });
    expect(store.users[0].emailVerified).toBe(false);
    // Whoever signed up there still can't sign in from home.
    expect((await login("victim@fedex.example", "squatter's password", "198.51.100.77", ATTACKER_HOME)).ok).toBe(false);
  });

  it("'Send the link again' by address ties the link to no device: the pilot's own sign-up still takes their own password", async () => {
    await signUpByEmail("victim@fedex.example", "pilot's own password", "Victim", LAPTOP, "192.0.2.5");
    await resendConfirmEmailByAddress("victim@fedex.example", "203.0.113.20", CREW_ROOM_PC);
    const link = lastConfirmLink()!;
    expect(await confirmEmail(link, null, CREW_ROOM_PC, {}, "203.0.113.20")).toMatchObject({ status: "needs-password" });
    expect(await confirmEmail(link, null, LAPTOP, { password: "pilot's own password" }, "192.0.2.5")).toMatchObject({ status: "confirmed", signedIn: "now" });
    expect(store.confirmTokens.every((t) => t.deviceHash === null)).toBe(true);
  });
});

describe("someone signing up with a pilot's address", () => {
  it("isn't confirmed by the pilot opening the link on their own phone, and can't sign in", async () => {
    await signUpByEmail("realpilot@fedex.example", "squatter pw 123", "Real Pilot", LAPTOP, SQUATTER_IP);
    const opened = await confirmEmail(lastConfirmLink()!, null, PHONE);
    expect(opened).toEqual({ status: "needs-password", email: "realpilot@fedex.example" });
    expect(store.users[0].emailVerified).toBe(false);
    const squat = await login("realpilot@fedex.example", "squatter pw 123", SQUATTER_IP, LAPTOP);
    expect(squat).toEqual({ ok: false, error: LOGIN_FAILED });
  });

  it("\"This wasn't me\" spends the link and sends the pilot a link that makes the account theirs", async () => {
    await signUpByEmail("realpilot@fedex.example", "squatter pw 123", "Real Pilot", LAPTOP, SQUATTER_IP);
    const link = lastConfirmLink()!;
    expect(await confirmEmail(link, null, PHONE, { notMe: true }, "203.0.113.50")).toEqual({ status: "not-me" });
    expect(store.users[0].emailVerified).toBe(false);
    expect(await confirmEmail(link, null, LAPTOP)).toEqual({ status: "used", yours: false });
    // Whoever made it is signed out of it, and any calendar link they made is revoked.
    expect(feeds.revoked).toContain(store.users[0].id);
    expect(mail.sent.at(-1)).toMatchObject({ to: "realpilot@fedex.example", subject: "Finish signing up for Line Select" });
    const taken = await resetPasswordWithEmailToken(lastResetLink()!, "owners own pw 456", "203.0.113.50", PHONE);
    expect(taken).toMatchObject({ ok: true, user: { emailVerified: true } });
    expect(taken.recoveryCode).toBeTruthy();
    expect((await login("realpilot@fedex.example", "squatter pw 123", SQUATTER_IP, LAPTOP)).ok).toBe(false);
    expect((await login("realpilot@fedex.example", "owners own pw 456", "203.0.113.50", PHONE)).ok).toBe(true);
  });

  it("a recovery code someone else made doesn't survive the owner's emailed reset, confirmed or not", async () => {
    // A confirmed account someone else got into and made a recovery code on.
    store.users.push(legacy({ email: "realpilot@fedex.example", emailVerified: true }));
    await createLegacyPassword("realpilot@fedex.example", "leaked pw 123");
    const made = await createRecoveryCodeForUser(store.users[0].id, "leaked pw 123");
    expect(made.recoveryCode).toBeTruthy();
    await requestPasswordResetEmail("realpilot@fedex.example", "203.0.113.50", PHONE);
    const owner = await resetPasswordWithEmailToken(lastResetLink()!, "owners own pw 456", "203.0.113.50", PHONE);
    expect(owner.ok).toBe(true);
    expect(owner.recoveryCode).toBeTruthy();
    expect(owner.recoveryCode).not.toBe(made.recoveryCode);
    const back = await resetPasswordWithRecoveryCode("realpilot@fedex.example", made.recoveryCode!, "squatter again 789", SQUATTER_IP, LAPTOP);
    expect(back.ok).toBe(false);
    expect((await login("realpilot@fedex.example", "owners own pw 456", "203.0.113.50", PHONE)).ok).toBe(true);
  });
});

describe("Send it again", () => {
  it(`sends ${RESENDS_PER_ACCOUNT} an hour for one account`, async () => {
    const results = [];
    for (let i = 0; i < RESENDS_PER_ACCOUNT + 2; i++) results.push(await resendConfirmEmail(legacy(), `203.0.113.${i}`, LAPTOP));
    expect(results.filter((r) => r.sent)).toHaveLength(RESENDS_PER_ACCOUNT);
    expect(results.at(-1)).toEqual({ sent: false, reason: "limited" });
    expect(mail.sent).toHaveLength(RESENDS_PER_ACCOUNT);
    // A link sent this way, to an account from before confirming existed, never lets the daily run remove it.
    expect(store.confirmTokens[0].signUp).toBe(false);
  });

  it("sends one address's share of the site's hour, across accounts", async () => {
    let sent = 0;
    for (let i = 0; i < RESENDS_PER_ADDRESS + 3; i++) {
      const r = await resendConfirmEmail(legacy({ id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`, email: `p${i}@example.com` }), "198.51.100.9", LAPTOP);
      if (r.sent) sent++;
    }
    expect(sent).toBe(Math.min(RESENDS_PER_ADDRESS, SITE_MAILS_PER_SENDER_PER_HOUR));
  });

  it("one address with a handful of made-up accounts can't use up the hour: a real pilot elsewhere still gets their link", async () => {
    // Five links an hour for each, more than the site's whole hour in all: without the share the pilot below gets nothing.
    const junk = Math.ceil(SITE_MAILS_PER_HOUR["sign-up"] / 5) + 1;
    for (let i = 0; i < junk; i++) store.users.push(legacy({ id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`, email: `junk${i}@attacker.example` }));
    for (let i = 0; i < junk; i++) for (let j = 0; j < 5; j++) await resendConfirmEmailByAddress(`junk${i}@attacker.example`, "203.0.113.66", `${String(i * 10 + j).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    expect(mail.sent.length).toBeLessThanOrEqual(SITE_MAILS_PER_SENDER_PER_HOUR);
    mail.sent.length = 0;
    await signUpByEmail("new.pilot@fedex.example", "a long password", "New Pilot", LAPTOP, "192.0.2.10");
    expect(mail.sent).toHaveLength(1);
    expect(store.users.some((u) => u.email === "new.pilot@fedex.example")).toBe(true);
  });

  it("sends nothing to a confirmed account, or when email isn't set up", async () => {
    expect(await resendConfirmEmail(legacy({ emailVerified: true }), "203.0.113.1", LAPTOP)).toEqual({ sent: false, reason: "confirmed" });
    mail.configured = false;
    expect(await resendConfirmEmail(legacy(), "203.0.113.1", LAPTOP)).toEqual({ sent: false, reason: "not-set-up" });
    expect(mail.sent).toHaveLength(0);
  });

  it("keeps a sign-up's first link marked as one, so the daily run can still remove it", async () => {
    await signUpByEmail("new@example.com", "a long password", "J. Pilot", LAPTOP);
    await resendConfirmEmail(store.users[0], "203.0.113.1", LAPTOP);
    expect(store.confirmTokens[0].signUp).toBe(true);
  });

  it("by address, from the log-in screen, mails only an account waiting on its link, five times an hour from one sender", async () => {
    await signUpByEmail("new@example.com", "a long password", "J. Pilot", LAPTOP);
    store.users.push(legacy({ email: "done@example.com", emailVerified: true }));
    mail.sent.length = 0;
    await resendConfirmEmailByAddress("done@example.com", "203.0.113.1", LAPTOP);
    await resendConfirmEmailByAddress("nobody@example.com", "203.0.113.1", LAPTOP);
    expect(mail.sent).toHaveLength(0);
    for (let i = 0; i < 7; i++) await resendConfirmEmailByAddress("New@Example.com", "203.0.113.1", LAPTOP);
    expect(mail.sent).toHaveLength(5);
    expect(mail.sent[0]).toMatchObject({ to: "new@example.com", subject: "Confirm your email for Line Select" });
  });
});
