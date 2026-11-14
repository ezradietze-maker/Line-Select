import { beforeEach, describe, expect, it, vi } from "vitest";

/** Sign out from a tab still showing one pilot after another signed in in another tab. Cookies and sessions faked. */
const jar = vi.hoisted(() => ({ token: "t-b" as string | undefined, header: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }),
  headers: async () => ({ get: (name: string) => (name === "x-line-select-account" ? jar.header : null) }),
}));
const auth = vi.hoisted(() => ({ endSession: vi.fn(async () => {}), getUserForSessionToken: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ SESSION_COOKIE: "ls_session", ...auth }));

const { POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUserForSessionToken.mockResolvedValue({ id: "pilot-b" });
});

describe("sign out", () => {
  it("leaves the session alone when the tab is for another pilot than the one signed in now", async () => {
    jar.header = "pilot-a";
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, otherAccount: true });
    expect(auth.endSession).not.toHaveBeenCalled();
  });

  it("ends it for the pilot it's for, and for a caller that doesn't say", async () => {
    for (const header of ["pilot-b", null]) {
      jar.header = header;
      expect((await POST()).status).toBe(200);
    }
    expect(auth.endSession).toHaveBeenCalledTimes(2);
  });
});
