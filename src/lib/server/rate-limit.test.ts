import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const counters = new Map<string, number>();

vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => store.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    if (typeof value === "number") counters.set(key, value);
  }),
  incrementCounter: vi.fn(async (key: string) => {
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  }),
}));

import { checkRateLimit, clearAttempts, takeAttempt } from "@/lib/server/rate-limit";

async function take(n: number, scope = "login", id = "pilot@example.com"): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push(await takeAttempt(scope, id));
  return out;
}

describe("takeAttempt", () => {
  beforeEach(() => {
    store.clear();
    counters.clear();
  });

  it("allows the first six attempts in a window and refuses the seventh", async () => {
    expect(await take(6)).toEqual([true, true, true, true, true, true]);
    expect(await takeAttempt("login", "pilot@example.com")).toBe(false);
  });

  it("counts a parallel burst one by one, so it can't all slip through on the same count", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => takeAttempt("login", "pilot@example.com")));
    expect(results.filter(Boolean)).toHaveLength(6);
  });

  it("clearing attempts un-blocks a previously rate-limited identifier", async () => {
    await take(7);
    await clearAttempts("login", "pilot@example.com");
    expect(await takeAttempt("login", "pilot@example.com")).toBe(true);
  });

  it("keeps separate identifiers under the same scope fully independent", async () => {
    await take(7, "login", "attacker@example.com");
    expect(await takeAttempt("login", "innocent@example.com")).toBe(true);
  });

  it("keeps separate scopes for the same identifier fully independent", async () => {
    await take(7, "login");
    expect(await takeAttempt("signup", "pilot@example.com")).toBe(true);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    store.clear();
    counters.clear();
  });

  it("allows requests under the limit", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit("test-bucket", "1.2.3.4", 5, 3600)).ok).toBe(true);
    }
  });

  it("blocks once the limit is exceeded within the same window", async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit("test-bucket", "1.2.3.4", 5, 3600);
    expect((await checkRateLimit("test-bucket", "1.2.3.4", 5, 3600)).ok).toBe(false);
  });

  it("keeps separate identities fully independent", async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit("test-bucket", "1.2.3.4", 5, 3600);
    expect((await checkRateLimit("test-bucket", "1.2.3.4", 5, 3600)).ok).toBe(false);
    expect((await checkRateLimit("test-bucket", "5.6.7.8", 5, 3600)).ok).toBe(true);
  });

  it("keeps separate buckets for the same identity fully independent", async () => {
    for (let i = 0; i < 5; i++) await checkRateLimit("bucket-a", "1.2.3.4", 5, 3600);
    expect((await checkRateLimit("bucket-a", "1.2.3.4", 5, 3600)).ok).toBe(false);
    expect((await checkRateLimit("bucket-b", "1.2.3.4", 5, 3600)).ok).toBe(true);
  });
});
