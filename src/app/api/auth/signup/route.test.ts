import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signUp: vi.fn(), SESSION_COOKIE: "ls_session", sessionCookieOptions: () => ({}) }));
vi.mock("@/lib/server/auth", () => auth);
vi.mock("@/lib/server/rate-limit", () => ({ checkRequestLimit: vi.fn().mockResolvedValue({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));

import { AUTH_LIMITS } from "@/lib/auth-limits";
import { POST } from "./route";

const req = (body: unknown) => new Request("https://lineselect.test/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
const ok = { email: "pilot@example.com", password: "long enough password", displayName: "J. Rodriguez" };

beforeEach(() => {
  vi.clearAllMocks();
  auth.signUp.mockResolvedValue({ ok: true, user: { id: "u1" }, sessionToken: "tok", recoveryCode: "CODE" });
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
