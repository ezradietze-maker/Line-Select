import { beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = new Map<string, unknown>();

vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    kvStore.set(key, value);
  }),
  incrementCounter: vi.fn(async () => 1),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

/** An in-memory stand-in for the db layer so reset can be tested end to end against real hashing. */
const store = vi.hoisted(() => ({
  users: [] as { id: string; email: string; displayName: string; createdAt: string }[],
  credentials: [] as { userId: string; email: string; passwordHash: string; salt: string; recoveryHash?: string; recoverySalt?: string }[],
  sessions: [] as { token: string; userId: string; expiresAt: string }[],
}));

vi.mock("@/lib/server/db", () => ({
  createUserWithCredential: vi.fn(async (user, credential) => {
    store.users.push(user);
    store.credentials.push(credential);
  }),
  createSession: vi.fn(async (s) => {
    store.sessions.push(s);
  }),
  deleteSession: vi.fn(async () => {}),
  deleteSessionsForUser: vi.fn(async (userId: string) => {
    store.sessions = store.sessions.filter((s) => s.userId !== userId);
  }),
  findCredentialByEmail: vi.fn(async (email: string) => store.credentials.find((c) => c.email === email) ?? null),
  findCredentialByUserId: vi.fn(async (id: string) => store.credentials.find((c) => c.userId === id) ?? null),
  findSession: vi.fn(),
  findUserByEmail: vi.fn(async (email: string) => store.users.find((u) => u.email === email) ?? null),
  findUserById: vi.fn(async (id: string) => store.users.find((u) => u.id === id) ?? null),
  updateCredential: vi.fn(async (userId: string, patch: object) => {
    const i = store.credentials.findIndex((c) => c.userId === userId);
    if (i !== -1) store.credentials[i] = { ...store.credentials[i], ...patch };
  }),
}));

import {
  createRecoveryCodeForUser,
  generateRecoveryCode,
  login,
  normalizeRecoveryCode,
  resetPasswordWithRecoveryCode,
  signUp,
} from "@/lib/server/auth";

const EMAIL = "pilot@example.com";
const OLD_PASSWORD = "old-password-1";

async function signUpPilot() {
  const result = await signUp(EMAIL, OLD_PASSWORD, "Test Pilot");
  expect(result.ok).toBe(true);
  return result;
}

describe("generateRecoveryCode", () => {
  it("makes five dash-separated groups of four unambiguous characters, different every time", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){4}$/);
    expect(a).not.toBe(b);
  });

  it("normalizes case, dashes and spaces away", () => {
    expect(normalizeRecoveryCode("abcd-efgh jkmn")).toBe("ABCDEFGHJKMN");
  });
});

describe("account recovery", () => {
  beforeEach(() => {
    kvStore.clear();
    store.users.length = 0;
    store.credentials.length = 0;
    store.sessions.length = 0;
  });

  it("gives a new account a recovery code at signup, and stores only a hash of it", async () => {
    const result = await signUpPilot();
    expect(result.recoveryCode).toBeTruthy();
    const cred = store.credentials[0];
    expect(cred.recoveryHash).toBeTruthy();
    expect(JSON.stringify(cred)).not.toContain(normalizeRecoveryCode(result.recoveryCode!));
  });

  it("resets the password with the right code — old password stops working, new one works", async () => {
    const { recoveryCode } = await signUpPilot();
    const reset = await resetPasswordWithRecoveryCode(EMAIL, recoveryCode!, "brand-new-pass");
    expect(reset.ok).toBe(true);
    expect((await login(EMAIL, OLD_PASSWORD)).ok).toBe(false);
    expect((await login(EMAIL, "brand-new-pass")).ok).toBe(true);
  });

  it("accepts the code however it was copied down (lowercase, spaces, no dashes)", async () => {
    const { recoveryCode } = await signUpPilot();
    const sloppy = recoveryCode!.toLowerCase().replace(/-/g, " ");
    expect((await resetPasswordWithRecoveryCode(EMAIL, sloppy, "brand-new-pass")).ok).toBe(true);
  });

  it("rotates the code — the used one can't be replayed, and a fresh one is returned", async () => {
    const { recoveryCode } = await signUpPilot();
    const first = await resetPasswordWithRecoveryCode(EMAIL, recoveryCode!, "brand-new-pass");
    expect(first.recoveryCode).toBeTruthy();
    expect(first.recoveryCode).not.toBe(recoveryCode);
    const replay = await resetPasswordWithRecoveryCode(EMAIL, recoveryCode!, "another-pass-1");
    expect(replay.ok).toBe(false);
  });

  it("signs out every existing session on reset, leaving only the new one", async () => {
    const { recoveryCode } = await signUpPilot();
    expect(store.sessions).toHaveLength(1);
    const staleToken = store.sessions[0].token;
    const reset = await resetPasswordWithRecoveryCode(EMAIL, recoveryCode!, "brand-new-pass");
    expect(store.sessions.find((s) => s.token === staleToken)).toBeUndefined();
    expect(store.sessions.map((s) => s.token)).toEqual([reset.sessionToken]);
  });

  it("rejects a wrong code, and gives the identical error for an unknown email so accounts can't be discovered", async () => {
    await signUpPilot();
    const wrongCode = await resetPasswordWithRecoveryCode(EMAIL, "AAAA-BBBB-CCCC-DDDD-EEEE", "brand-new-pass");
    const unknownEmail = await resetPasswordWithRecoveryCode("nobody@example.com", "AAAA-BBBB-CCCC-DDDD-EEEE", "brand-new-pass");
    expect(wrongCode.ok).toBe(false);
    expect(unknownEmail.ok).toBe(false);
    expect(wrongCode.error).toBe(unknownEmail.error);
    expect((await login(EMAIL, OLD_PASSWORD)).ok).toBe(true);
  });

  it("rejects a too-short new password without spending the recovery code", async () => {
    const { recoveryCode } = await signUpPilot();
    expect((await resetPasswordWithRecoveryCode(EMAIL, recoveryCode!, "abc")).ok).toBe(false);
    expect((await resetPasswordWithRecoveryCode(EMAIL, recoveryCode!, "long-enough-1")).ok).toBe(true);
  });

  it("refuses an account that never had a recovery code, same generic error", async () => {
    await signUpPilot();
    store.credentials[0].recoveryHash = undefined;
    store.credentials[0].recoverySalt = undefined;
    const result = await resetPasswordWithRecoveryCode(EMAIL, "AAAA-BBBB-CCCC-DDDD-EEEE", "brand-new-pass");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("That email and recovery code don't match.");
  });

  it("locks out further reset attempts after repeated failures", async () => {
    await signUpPilot();
    for (let i = 0; i < 6; i++) await resetPasswordWithRecoveryCode(EMAIL, "AAAA-BBBB-CCCC-DDDD-EEEE", "brand-new-pass");
    const locked = await resetPasswordWithRecoveryCode(EMAIL, "AAAA-BBBB-CCCC-DDDD-EEEE", "brand-new-pass");
    expect(locked.error).toMatch(/too many/i);
  });
});

describe("createRecoveryCodeForUser", () => {
  beforeEach(() => {
    kvStore.clear();
    store.users.length = 0;
    store.credentials.length = 0;
    store.sessions.length = 0;
  });

  it("mints a working code for a signed-in pilot who re-enters their password, replacing the old one", async () => {
    const { recoveryCode: original } = await signUpPilot();
    const userId = store.users[0].id;
    const fresh = await createRecoveryCodeForUser(userId, OLD_PASSWORD);
    expect(fresh.ok).toBe(true);
    expect(fresh.recoveryCode).not.toBe(original);
    expect((await resetPasswordWithRecoveryCode(EMAIL, original!, "brand-new-pass")).ok).toBe(false);
    expect((await resetPasswordWithRecoveryCode(EMAIL, fresh.recoveryCode!, "brand-new-pass")).ok).toBe(true);
  });

  it("refuses without the right password", async () => {
    await signUpPilot();
    const result = await createRecoveryCodeForUser(store.users[0].id, "wrong-password");
    expect(result.ok).toBe(false);
    expect(result.recoveryCode).toBeUndefined();
  });
});
