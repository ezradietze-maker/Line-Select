import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => store.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
}));

import { clearAttempts, isRateLimited, recordFailedAttempt } from "@/lib/server/rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    store.clear();
  });

  it("is not rate limited before any failed attempts", async () => {
    expect(await isRateLimited("login", "pilot@example.com")).toBe(false);
  });

  it("stays unlimited under the failure ceiling", async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt("login", "pilot@example.com");
    expect(await isRateLimited("login", "pilot@example.com")).toBe(false);
  });

  it("blocks once the failure ceiling is reached", async () => {
    for (let i = 0; i < 6; i++) await recordFailedAttempt("login", "pilot@example.com");
    expect(await isRateLimited("login", "pilot@example.com")).toBe(true);
  });

  it("clearing attempts un-blocks a previously rate-limited identifier", async () => {
    for (let i = 0; i < 6; i++) await recordFailedAttempt("login", "pilot@example.com");
    expect(await isRateLimited("login", "pilot@example.com")).toBe(true);
    await clearAttempts("login", "pilot@example.com");
    expect(await isRateLimited("login", "pilot@example.com")).toBe(false);
  });

  it("keeps separate identifiers under the same scope fully independent", async () => {
    for (let i = 0; i < 6; i++) await recordFailedAttempt("login", "attacker@example.com");
    expect(await isRateLimited("login", "attacker@example.com")).toBe(true);
    expect(await isRateLimited("login", "innocent@example.com")).toBe(false);
  });

  it("keeps separate scopes for the same identifier fully independent", async () => {
    for (let i = 0; i < 6; i++) await recordFailedAttempt("login", "pilot@example.com");
    expect(await isRateLimited("login", "pilot@example.com")).toBe(true);
    expect(await isRateLimited("signup", "pilot@example.com")).toBe(false);
  });
});
