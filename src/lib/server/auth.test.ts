import { scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = new Map<string, unknown>();

vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    kvStore.set(key, value);
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
}));

vi.mock("@/lib/server/db", () => dbMocks);

import { login } from "@/lib/server/auth";

describe("login", () => {
  beforeEach(async () => {
    kvStore.clear();
    dbMocks.findCredentialByEmail.mockReset();
    dbMocks.findUserById.mockReset();
    dbMocks.createSession.mockReset().mockResolvedValue(undefined);

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
    expect(result.error).toBe("Incorrect password.");
  });

  it("rejects an email with no account", async () => {
    dbMocks.findCredentialByEmail.mockResolvedValue(null);
    const result = await login("nobody@example.com", "whatever");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("No account found with that email.");
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

  it("rate-limits a different email independently", async () => {
    for (let i = 0; i < 6; i++) await login(EMAIL, "wrong-password");
    dbMocks.findCredentialByEmail.mockResolvedValue(null);
    const other = await login("someone-else@example.com", "whatever");
    expect(other.error).toBe("No account found with that email.");
  });
});
