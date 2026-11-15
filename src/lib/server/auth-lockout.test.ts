import { scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Whether someone trying passwords from elsewhere can keep a pilot out of their own account. In-memory kv, never Redis. */
const kv = vi.hoisted(() => new Map<string, unknown>());
/** When a key set with a time to live runs out, as Redis would drop it. */
const expires = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (k: string) => ((expires.get(k) ?? Infinity) > Date.now() ? (kv.get(k) ?? null) : null)),
  setJson: vi.fn(async (k: string, v: unknown, o?: { ttlSeconds?: number }) => {
    kv.set(k, v);
    if (o?.ttlSeconds) expires.set(k, Date.now() + o.ttlSeconds * 1000);
    else expires.delete(k);
  }),
  extendKey: vi.fn(async (k: string, ttl: number) => {
    if ((expires.get(k) ?? Infinity) > Date.now() && kv.has(k)) expires.set(k, Date.now() + ttl * 1000);
  }),
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
vi.mock("@/lib/server/email", () => ({ getEmailConfig: () => ({ apiKey: "k", from: "a@b.c", appUrl: "https://app.example.com" }), sendEmail: vi.fn(async () => true) }));

const scrypt = promisify(scryptCallback);
const SALT = "s";
const PW = "the-real-password";
const EMAIL = "pilot@example.com";
const USER = "11111111-1111-1111-1111-111111111111";
const db = vi.hoisted(() => ({
  findCredentialByEmail: vi.fn(),
  findUserById: vi.fn(),
  createSession: vi.fn(async () => {}),
  deleteSessionsForUser: vi.fn(async () => {}),
  updateCredential: vi.fn(async () => {}),
  consumeResetToken: vi.fn(async () => USER),
  markEmailVerified: vi.fn(async () => {}),
  isUnconfirmedSignUp: vi.fn(async () => false),
}));
vi.mock("@/lib/server/db", () => db);

const { login, resetPasswordWithEmailToken } = await import("@/lib/server/auth");

const ATTACKER = "198.51.100.7";
const HOME = "203.0.113.50";
const LAPTOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(async () => {
  kv.clear();
  expires.clear();
  const passwordHash = ((await scrypt(PW, SALT, 64)) as Buffer).toString("hex");
  db.findCredentialByEmail.mockResolvedValue({ userId: USER, email: EMAIL, passwordHash, salt: SALT });
  db.findUserById.mockResolvedValue({ id: USER, email: EMAIL, displayName: "P", createdAt: "", plan: "free", emailVerified: true });
});

describe("sign-in limits for one account", () => {
  it("51 wrong passwords from one address don't keep the pilot out from another", async () => {
    for (let i = 0; i < 51; i++) await login(EMAIL, "wrong", ATTACKER);
    expect((await login(EMAIL, PW, ATTACKER)).ok).toBe(false);
    expect((await login(EMAIL, PW, HOME)).ok).toBe(true);
  });

  it("still stops guessing spread across many addresses", async () => {
    for (let a = 0; a < 12; a++) for (let i = 0; i < 6; i++) await login(EMAIL, "wrong", `198.51.100.${a}`);
    const fromNew = await login(EMAIL, PW, HOME);
    expect(fromNew.ok).toBe(false);
    expect(fromNew.error).toMatch(/Too many failed attempts/);
    // 73 sign-ins, each hashing a password: over the default 5 seconds on a busy machine.
  }, 30_000);

  it("a device that has signed in to the account before still gets in once the account-wide ceiling is reached", async () => {
    expect((await login(EMAIL, PW, HOME, LAPTOP)).ok).toBe(true);
    for (let a = 0; a < 20; a++) await login(EMAIL, "wrong", `198.51.100.${a}`);
    expect((await login(EMAIL, PW, "192.0.2.9")).ok).toBe(false);
    expect((await login(EMAIL, PW, "192.0.2.9", LAPTOP)).ok).toBe(true);
    // A device id the account has never seen is held to the ceiling like anyone.
    expect((await login(EMAIL, PW, "192.0.2.10", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).ok).toBe(false);
  });

  it("a known device still has its own address's few tries, no more", async () => {
    expect((await login(EMAIL, PW, HOME, LAPTOP)).ok).toBe(true);
    for (let i = 0; i < 6; i++) await login(EMAIL, "wrong", ATTACKER, LAPTOP);
    expect((await login(EMAIL, PW, ATTACKER, LAPTOP)).ok).toBe(false);
  });

  it("an emailed reset clears the account-wide count and that address's own", async () => {
    for (let a = 0; a < 12; a++) await login(EMAIL, "wrong", `198.51.100.${a}`);
    for (let i = 0; i < 6; i++) await login(EMAIL, "wrong", HOME);
    expect((await login(EMAIL, PW, HOME)).ok).toBe(false);
    expect((await resetPasswordWithEmailToken("token", "a-new-password", HOME)).ok).toBe(true);
    // The new password is what the credential now holds.
    // The password's update, not the new recovery code's that follows it.
    const updated = (db.updateCredential.mock.calls as unknown as [string, { passwordHash?: string; salt?: string }][]).map((c) => c[1]).filter((p) => p.passwordHash).at(-1)!;
    db.findCredentialByEmail.mockResolvedValue({ userId: USER, email: EMAIL, ...updated });
    expect((await login(EMAIL, "a-new-password", HOME)).ok).toBe(true);
    expect((await login(EMAIL, "a-new-password", "192.0.2.77")).ok).toBe(true);
  });
});

describe("devices known from before a reset", () => {
  const INTRUDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("aren't known any more: whoever was signed in on one is held to the account-wide ceiling like anyone", async () => {
    // Someone with the old password signs in on their own device, so the account knows it.
    expect((await login(EMAIL, PW, ATTACKER, INTRUDER)).ok).toBe(true);
    // The pilot takes the account back on their laptop.
    expect((await resetPasswordWithEmailToken("token", "a-new-password", HOME, LAPTOP)).ok).toBe(true);
    const updated = (db.updateCredential.mock.calls as unknown as [string, { passwordHash?: string; salt?: string }][]).map((c) => c[1]).filter((p) => p.passwordHash).at(-1)!;
    db.findCredentialByEmail.mockResolvedValue({ userId: USER, email: EMAIL, ...updated });
    // Their device cookie works from any address: guessing the new password from many, it must still reach the ceiling.
    for (let a = 0; a < 13; a++) await login(EMAIL, "wrong", `198.51.100.${a}`, INTRUDER);
    const guessed = await login(EMAIL, "a-new-password", "192.0.2.9", INTRUDER);
    expect(guessed.ok).toBe(false);
    expect(guessed.error).toMatch(/Too many failed attempts/);
    // The device the pilot reset on is known from then on, and gets in.
    expect((await login(EMAIL, "a-new-password", "192.0.2.10", LAPTOP)).ok).toBe(true);
  }, 30_000);

  it("the device the pilot reset on stays known as long as they keep signing in on it, past the half year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
      expect((await resetPasswordWithEmailToken("token", "a-new-password", HOME, LAPTOP)).ok).toBe(true);
      const updated = (db.updateCredential.mock.calls as unknown as [string, { passwordHash?: string; salt?: string }][]).map((c) => c[1]).filter((p) => p.passwordHash).at(-1)!;
      db.findCredentialByEmail.mockResolvedValue({ userId: USER, email: EMAIL, ...updated });
      // Signed in on the laptop every month for five months.
      const day = (n: number) => new Date(Date.parse("2026-11-15T12:00:00Z") + n * 24 * 3600_000);
      for (let month = 1; month <= 5; month++) {
        vi.setSystemTime(day(month * 30));
        expect((await login(EMAIL, "a-new-password", HOME, LAPTOP)).ok).toBe(true);
      }
      // A month on, just past half a year since the reset, someone guessing from many addresses shuts the account to
      // everyone else: the laptop, last signed in a month ago, still gets in.
      vi.setSystemTime(day(185));
      for (let a = 0; a < 13; a++) await login(EMAIL, "wrong", `198.51.100.${a}`);
      expect((await login(EMAIL, "a-new-password", "192.0.2.9")).ok).toBe(false);
      expect((await login(EMAIL, "a-new-password", "192.0.2.10", LAPTOP)).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});

describe("one IPv6 connection", () => {
  it("counts as one address: twelve tries from twelve addresses in its /64 don't shut the account to everyone", async () => {
    for (let a = 1; a <= 12; a++) await login(EMAIL, "wrong", `2001:db8:1234:5678::${a.toString(16)}`);
    expect((await login(EMAIL, PW, HOME, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).ok).toBe(true);
  });

  it("gets one address's few tries across its whole /64", async () => {
    for (let a = 1; a <= 6; a++) await login(EMAIL, "wrong", `2001:db8:1234:5678::${a.toString(16)}`);
    expect((await login(EMAIL, PW, "2001:db8:1234:5678::ff")).ok).toBe(false);
    expect((await login(EMAIL, PW, "2001:db8:1234:9999::1")).ok).toBe(true);
  });
});
