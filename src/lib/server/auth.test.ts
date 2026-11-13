import { scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = new Map<string, unknown>();

vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    kvStore.set(key, value);
  }),
  incrementCounter: vi.fn(async (key: string) => {
    const next = ((kvStore.get(key) as number | undefined) ?? 0) + 1;
    kvStore.set(key, next);
    return next;
  }),
}));

const scrypt = promisify(scryptCallback);
const SALT = "test-salt";
const CORRECT_PASSWORD = "correct-horse-battery-staple";

async function hashFor(password: string): Promise<string> {
  const derived = (await scrypt(password, SALT, 64)) as Buffer;
  return derived.toString("hex");
}

const EMAIL = "pilot@example.com";

const dbMocks = vi.hoisted(() => ({
  findCredentialByEmail: vi.fn(),
  findUserById: vi.fn(),
  createSession: vi.fn(async () => {}),
  isUnconfirmedSignUp: vi.fn(async () => false),
  updateCredential: vi.fn(async () => {}),
}));

vi.mock("@/lib/server/db", () => dbMocks);

import { LOGIN_FAILED, login } from "@/lib/server/auth";

describe("login", () => {
  beforeEach(async () => {
    kvStore.clear();
    dbMocks.findCredentialByEmail.mockReset();
    dbMocks.findUserById.mockReset();
    dbMocks.createSession.mockReset().mockResolvedValue(undefined);
    dbMocks.isUnconfirmedSignUp.mockReset().mockResolvedValue(false);

    const passwordHash = await hashFor(CORRECT_PASSWORD);
    dbMocks.findCredentialByEmail.mockResolvedValue({
      userId: "user-1",
      email: EMAIL,
      passwordHash,
      salt: SALT,
    });
    dbMocks.findUserById.mockResolvedValue({
      id: "user-1",
      email: EMAIL,
      displayName: "Test Pilot",
      createdAt: new Date().toISOString(),
    });
  });

  it("succeeds with the correct password and returns a session token", async () => {
    const result = await login(EMAIL, CORRECT_PASSWORD);
    expect(result.ok).toBe(true);
    expect(result.user?.email).toBe(EMAIL);
    expect(result.sessionToken).toBeTruthy();
  });

  it("rejects the wrong password without revealing anything beyond that", async () => {
    const result = await login(EMAIL, "wrong-password");
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOGIN_FAILED);
  });

  it("rejects an email with no account", async () => {
    dbMocks.findCredentialByEmail.mockResolvedValue(null);
    const result = await login("nobody@example.com", "whatever");
    expect(result.ok).toBe(false);
    expect(result.error).toBe(LOGIN_FAILED);
  });

  it("locks out further attempts after enough failures, even with the correct password", async () => {
    for (let i = 0; i < 6; i++) {
      const result = await login(EMAIL, "wrong-password");
      expect(result.ok).toBe(false);
    }
    const lockedOut = await login(EMAIL, CORRECT_PASSWORD);
    expect(lockedOut.ok).toBe(false);
    expect(lockedOut.error).toMatch(/too many/i);
  });

  it("never even checks the password once rate-limited", async () => {
    for (let i = 0; i < 6; i++) await login(EMAIL, "wrong-password");
    dbMocks.findCredentialByEmail.mockClear();
    await login(EMAIL, CORRECT_PASSWORD);
    expect(dbMocks.findCredentialByEmail).not.toHaveBeenCalled();
  });

  it("a successful login clears prior failures, so an earlier typo doesn't count against a later lockout", async () => {
    await login(EMAIL, "wrong-password");
    await login(EMAIL, "wrong-password");
    const success = await login(EMAIL, CORRECT_PASSWORD);
    expect(success.ok).toBe(true);

    // Should now take a fresh 6 failures to lock out again, not just 4 more.
    for (let i = 0; i < 5; i++) {
      const result = await login(EMAIL, "wrong-password");
      expect(result.error).not.toMatch(/too many/i);
    }
  });

  it("turns away the right password to an account made by signing up and not yet confirmed, with the wrong password's words", async () => {
    dbMocks.isUnconfirmedSignUp.mockResolvedValue(true);
    const right = await login(EMAIL, CORRECT_PASSWORD);
    const wrong = await login(EMAIL, "wrong-password");
    expect(right).toEqual(wrong);
    expect(right).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(LOGIN_FAILED).toMatch(/If you just signed up, open the link we emailed you first/);
    expect(dbMocks.createSession).not.toHaveBeenCalled();
  });

  it("still lets in an account from before confirming existed, confirmed or not", async () => {
    dbMocks.isUnconfirmedSignUp.mockResolvedValue(false);
    expect((await login(EMAIL, CORRECT_PASSWORD)).ok).toBe(true);
  });

  it("gives an account with no recovery code its first one at sign-in, shown once, and none to an account that has one", async () => {
    const first = await login(EMAIL, CORRECT_PASSWORD);
    expect(first.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
    expect(dbMocks.updateCredential).toHaveBeenCalledWith("user-1", expect.objectContaining({ recoveryHash: expect.any(String) }));
    const credential = await dbMocks.findCredentialByEmail.getMockImplementation()?.(EMAIL);
    dbMocks.findCredentialByEmail.mockResolvedValue({ ...credential, recoveryHash: "h", recoverySalt: "s" });
    expect((await login(EMAIL, CORRECT_PASSWORD)).recoveryCode).toBeUndefined();
  });

  it("rate-limits a different email independently", async () => {
    for (let i = 0; i < 6; i++) await login(EMAIL, "wrong-password");
    dbMocks.findCredentialByEmail.mockResolvedValue(null);
    const other = await login("someone-else@example.com", "whatever");
    expect(other.error).toBe(LOGIN_FAILED);
  });
});
