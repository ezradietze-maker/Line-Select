import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signUp: vi.fn(), SESSION_COOKIE: "ls_session", sessionCookieOptions: () => ({}) }));
vi.mock("@/lib/server/auth", () => auth);
// Fixed-window counters, as the real limiter keeps them, with a clock the tests move.
const limits = vi.hoisted(() => ({ counts: new Map<string, number>(), now: 0 }));
vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: async (bucket: string, identity: string, limit: number, windowSeconds: number) => {
    const key = `${bucket}:${identity}:${Math.floor(limits.now / 1000 / windowSeconds)}`;
    const n = (limits.counts.get(key) ?? 0) + 1;
    limits.counts.set(key, n);
    return { ok: n <= limit };
  },
  clientIp: (r: Request) => r.headers.get("x-forwarded-for") ?? "unknown",
  rateLimitedResponse: () => new Response(null, { status: 429 }),
}));

import { AUTH_LIMITS } from "@/lib/auth-limits";
import { POST } from "./route";

// Each request from its own address unless a test names one, so the field checks below never meet the limit.
let addresses = 0;
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://lineselect.test/api/auth/signup", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `198.51.100.${++addresses}`, ...headers } });
const ok = { email: "pilot@example.com", password: "long enough password", displayName: "J. Rodriguez" };

beforeEach(() => {
  vi.clearAllMocks();
  limits.counts.clear();
  limits.now = Date.UTC(2026, 10, 11, 0, 30);
  auth.signUp.mockResolvedValue({ ok: true, user: { id: "u1" }, sessionToken: "tok", recoveryCode: "CODE" });
});

describe("accounts from one address", () => {
  const from = (n: number) => req(ok, { "x-forwarded-for": "203.0.113.7", cookie: `ls_device=device-${n}` });

  it("are 3 an hour, whatever device each comes from", async () => {
    for (let n = 0; n < 3; n++) expect((await POST(from(n))).status).toBe(200);
    expect((await POST(from(3))).status).toBe(429);
    // Another address is its own.
    expect((await POST(req(ok, { "x-forwarded-for": "203.0.113.8" }))).status).toBe(200);
  });

  it("are 10 a day, enough for a crew room's new pilots", async () => {
    let made = 0;
    for (let hour = 0; hour < 6; hour++) {
      limits.now += 60 * 60 * 1000;
      for (let n = 0; n < 3; n++) if ((await POST(from(hour * 3 + n))).status === 200) made++;
    }
    expect(made).toBe(10);
  });
});

describe("/api/auth/signup", () => {
  it("says which field is too long, instead of that it's missing", async () => {
    for (const [field, max, words] of [
      ["displayName", AUTH_LIMITS.displayName, "Display name can be at most 80 characters."],
      ["password", AUTH_LIMITS.password, "Password can be at most 500 characters."],
      ["email", AUTH_LIMITS.email, "Email can be at most 200 characters."],
    ] as const) {
      const res = await POST(req({ ...ok, [field]: "x".repeat(max + 1) }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(words);
    }
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("still says a blank field is required", async () => {
    const res = await POST(req({ ...ok, displayName: "" }));
    expect((await res.json()).error).toBe("Email, password, and display name are required.");
  });

  it("takes each field at its longest", async () => {
    const res = await POST(req({ email: `${"x".repeat(AUTH_LIMITS.email - 12)}@example.com`, password: "x".repeat(AUTH_LIMITS.password), displayName: "x".repeat(AUTH_LIMITS.displayName) }));
    expect(res.status).toBe(200);
    expect(auth.signUp).toHaveBeenCalledOnce();
  });
});
