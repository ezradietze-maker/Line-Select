import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory KV, never Redis or the local file; no database, no email.
const store = new Map<string, number>();
vi.mock("@/lib/server/kv", () => ({
  incrementCounter: async (k: string) => {
    const n = (store.get(k) ?? 0) + 1;
    store.set(k, n);
    return n;
  },
  setJson: async () => {},
}));
const accounts = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/server/db", () => ({ findCredentialByEmail: async (email: string) => (accounts.has(email) ? { userId: email, email } : null) }));
const mail = vi.hoisted(() => ({ configured: true, asked: [] as string[] }));
vi.mock("@/lib/server/email", () => ({ isEmailConfigured: () => mail.configured }));
vi.mock("@/lib/server/auth", () => ({
  requestPasswordResetEmail: async (email: string) => {
    mail.asked.push(email);
    return mail.configured;
  },
}));
vi.mock("@/lib/server/rate-limit", async (real) => ({ ...(await real<typeof import("@/lib/server/rate-limit")>()), checkRequestLimit: async () => ({ ok: true }) }));

const { POST } = await import("./route");
const ask = (email: string) => POST(new Request("https://example.com/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }));

beforeEach(() => {
  store.clear();
  accounts.clear();
  mail.asked.length = 0;
  mail.configured = true;
});

describe("POST /api/auth/forgot, across the whole site", () => {
  it("sends at most 20 reset emails an hour, and answers the same past that", async () => {
    for (let n = 0; n < 30; n++) accounts.add(`pilot${n}@example.com`);
    const answers = [];
    for (let n = 0; n < 30; n++) answers.push(await (await ask(`Pilot${n}@example.com `)).json());
    expect(mail.asked).toHaveLength(20);
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ emailEnabled: true })]));
  });

  it("doesn't count addresses with no account, which are never mailed", async () => {
    accounts.add("real@example.com");
    for (let n = 0; n < 50; n++) await ask(`nobody${n}@example.com`);
    await ask("real@example.com");
    expect(mail.asked.at(-1)).toBe("real@example.com");
    expect([...store.values()]).toEqual([1]);
  });

  it("still says when email isn't set up", async () => {
    mail.configured = false;
    expect(await (await ask("pilot@example.com")).json()).toEqual({ emailEnabled: false });
  });
});
