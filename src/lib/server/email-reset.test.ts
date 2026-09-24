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

const sent = vi.hoisted(() => ({ messages: [] as { to: string; subject: string; text: string }[], configured: true }));

vi.mock("@/lib/server/email", () => ({
  getEmailConfig: vi.fn(() => (sent.configured ? { apiKey: "k", from: "Line Select <a@b.c>", appUrl: "https://app.example.com" } : null)),
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sent.messages.push(m);
    return true;
  }),
  isEmailConfigured: vi.fn(() => sent.configured),
}));

const store = vi.hoisted(() => ({
  users: [] as { id: string; email: string; displayName: string; createdAt: string }[],
  credentials: [] as { userId: string; email: string; passwordHash: string; salt: string }[],
  sessions: [] as { token: string; userId: string; expiresAt: string }[],
  tokens: [] as { tokenHash: string; userId: string; expiresAt: string }[],
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
  saveResetToken: vi.fn(async (t) => {
    store.tokens = store.tokens.filter((x) => x.userId !== t.userId);
    store.tokens.push(t);
  }),
  consumeResetToken: vi.fn(async (hash: string) => {
    const t = store.tokens.find((x) => x.tokenHash === hash);
    if (!t) return null;
    store.tokens = store.tokens.filter((x) => x.tokenHash !== hash);
    return new Date(t.expiresAt).getTime() > Date.now() ? t.userId : null;
  }),
}));

import { login, requestPasswordResetEmail, resetPasswordWithEmailToken, signUp } from "@/lib/server/auth";

const EMAIL = "pilot@example.com";

function tokenFromLastEmail(): string {
  const match = sent.messages.at(-1)?.text.match(/reset-password\?token=([0-9a-f]+)/);
  expect(match).toBeTruthy();
  return match![1];
}

describe("emailed password reset", () => {
  beforeEach(async () => {
    kvStore.clear();
    store.users.length = 0;
    store.credentials.length = 0;
    store.sessions.length = 0;
    store.tokens.length = 0;
    sent.messages.length = 0;
    sent.configured = true;
    expect((await signUp(EMAIL, "old-password-1", "Test Pilot")).ok).toBe(true);
  });

  it("emails a link built from the configured app URL, and stores only a hash of its token", async () => {
    expect(await requestPasswordResetEmail(EMAIL)).toBe(true);
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].to).toBe(EMAIL);
    expect(sent.messages[0].text).toContain("https://app.example.com/reset-password?token=");
    expect(JSON.stringify(store.tokens)).not.toContain(tokenFromLastEmail());
  });

  it("sets a new password from the link, signs the pilot in, and signs out older sessions", async () => {
    await requestPasswordResetEmail(EMAIL);
    const result = await resetPasswordWithEmailToken(tokenFromLastEmail(), "brand-new-pass");
    expect(result.ok).toBe(true);
    expect(result.sessionToken).toBeTruthy();
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].token).toBe(result.sessionToken);
    expect((await login(EMAIL, "old-password-1")).ok).toBe(false);
    expect((await login(EMAIL, "brand-new-pass")).ok).toBe(true);
  });

  it("works once — the same link can't be replayed", async () => {
    await requestPasswordResetEmail(EMAIL);
    const token = tokenFromLastEmail();
    expect((await resetPasswordWithEmailToken(token, "brand-new-pass")).ok).toBe(true);
    expect((await resetPasswordWithEmailToken(token, "another-pass-2")).ok).toBe(false);
  });

  it("asking again replaces the earlier link", async () => {
    await requestPasswordResetEmail(EMAIL);
    const first = tokenFromLastEmail();
    await requestPasswordResetEmail(EMAIL);
    expect((await resetPasswordWithEmailToken(first, "brand-new-pass")).ok).toBe(false);
    expect((await resetPasswordWithEmailToken(tokenFromLastEmail(), "brand-new-pass")).ok).toBe(true);
  });

  it("rejects an expired link and a made-up one", async () => {
    await requestPasswordResetEmail(EMAIL);
    store.tokens[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await resetPasswordWithEmailToken(tokenFromLastEmail(), "brand-new-pass")).ok).toBe(false);
    expect((await resetPasswordWithEmailToken("deadbeef", "brand-new-pass")).ok).toBe(false);
  });

  it("rejects a too-short new password without spending the link", async () => {
    await requestPasswordResetEmail(EMAIL);
    const token = tokenFromLastEmail();
    expect((await resetPasswordWithEmailToken(token, "short")).ok).toBe(false);
    expect((await resetPasswordWithEmailToken(token, "long-enough-1")).ok).toBe(true);
  });

  it("answers the same for an address with no account, and sends nothing", async () => {
    expect(await requestPasswordResetEmail("nobody@example.com")).toBe(true);
    expect(sent.messages).toHaveLength(0);
  });

  it("does nothing and says so when no email provider is configured", async () => {
    sent.configured = false;
    expect(await requestPasswordResetEmail(EMAIL)).toBe(false);
    expect(sent.messages).toHaveLength(0);
  });
});
