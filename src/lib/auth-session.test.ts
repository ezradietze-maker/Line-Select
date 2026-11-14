import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lost = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/connection", () => ({ reportConnectionLost: () => void lost.count++ }));

import { checkSession } from "@/lib/auth";

/** A server that never answers, as on a hotel's Wi-Fi that's there but crawling: only giving up ends the request. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
}

beforeEach(() => {
  lost.count = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("checkSession", () => {
  it("gives up on a server that doesn't answer, so the load carries on as the account last signed in here", async () => {
    // Before, the request had no limit: every screen of a signed-in pilot sat on "Loading…" for as long as it hung.
    vi.stubGlobal("fetch", hangingFetch());
    let answer: { reachable: boolean } | null = null;
    void checkSession().then((a) => (answer = a));
    await vi.advanceTimersByTimeAsync(7_900);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(answer).toEqual({ user: null, reachable: false });
    expect(lost.count).toBe(1);
  });

  it("marks the app offline when the request can't connect at all", async () => {
    // A hotel's Wi-Fi with nothing behind it: the browser still says online, so only a failed request can tell.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await checkSession()).toEqual({ user: null, reachable: false });
    expect(lost.count).toBe(1);
  });

  it("reads an answer that comes in time, and a server error isn't taken as signed out", async () => {
    const user = { id: "u1", email: "a@example.test", displayName: "A", createdAt: "2026-10-01T00:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })));
    expect(await checkSession()).toEqual({ user, reachable: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect(await checkSession()).toEqual({ user: null, reachable: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect(await checkSession()).toEqual({ user: null, reachable: true });
    expect(lost.count).toBe(0);
  });
});
