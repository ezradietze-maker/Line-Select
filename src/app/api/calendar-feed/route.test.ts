import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentServerUser: vi.fn() }));
vi.mock("@/lib/server/auth", () => auth);
const feeds = vi.hoisted(() => ({ feedStatus: vi.fn(), revokeFeed: vi.fn(), setFeedOptions: vi.fn(), startFeed: vi.fn(), syncFeed: vi.fn() }));
vi.mock("@/lib/server/calendar-feeds", () => feeds);
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: rate.checkRateLimit, rateLimitedResponse: () => new Response(null, { status: 429 }) }));
// `enforced`: the membership model as it runs with FREE_FOR_ALL off; otherwise the pilot has a membership.
const membership = vi.hoisted(() => ({ enforced: false }));
vi.mock("@/lib/membership", async (real) => {
  const m = await real<typeof import("@/lib/membership")>();
  return { ...m, hasAccess: (u: Parameters<typeof m.hasAccess>[0]) => (membership.enforced ? m.isMember(u) : true) };
});

import { DELETE, GET, PATCH, POST, PUT } from "./route";

const req = (method: string, body?: unknown) => new Request("https://lineselect.test/api/calendar-feed", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const choice = { packId: "p", lineNumber: "1004", lineSource: "top", pilotClose: null };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentServerUser.mockResolvedValue({ id: "u1" });
  rate.checkRateLimit.mockResolvedValue({ ok: true });
});

describe("/api/calendar-feed", () => {
  it("is for signed-in pilots only", async () => {
    auth.getCurrentServerUser.mockResolvedValue(null);
    for (const res of [await GET(), await POST(req("POST", {})), await PATCH(req("PATCH", { homeDays: true })), await PUT(req("PUT", choice)), await DELETE(req("DELETE"))]) expect(res.status).toBe(401);
    expect(feeds.startFeed).not.toHaveBeenCalled();
  });

  it("sends the link when making one, built on this site", async () => {
    feeds.startFeed.mockResolvedValue({ token: "tok", status: { on: true } });
    const json = await (await POST(req("POST", { homeDays: true }))).json();
    expect(json).toEqual({ on: true, url: "https://lineselect.test/api/calendar/tok.ics" });
    expect(feeds.startFeed).toHaveBeenCalledWith("u1", { homeDays: true });
  });

  it("never returns a link from status", async () => {
    feeds.feedStatus.mockResolvedValue({ on: true });
    expect(await (await GET()).json()).toEqual({ on: true });
  });

  it("checks a choice before using it", async () => {
    for (const bad of [{}, { ...choice, packId: "" }, { ...choice, lineSource: "guess" }, { ...choice, lineNumber: 4 }, { ...choice, pilotClose: "soon" }]) {
      expect((await PUT(req("PUT", bad))).status).toBe(400);
    }
    expect(feeds.syncFeed).not.toHaveBeenCalled();
    feeds.syncFeed.mockResolvedValue("ok");
    expect(await (await PUT(req("PUT", choice))).json()).toEqual({ result: "ok" });
    expect(feeds.syncFeed).toHaveBeenCalledWith("u1", choice);
  });

  it("rejects a bad option", async () => {
    expect((await PATCH(req("PATCH", { homeDays: "yes" }))).status).toBe(400);
  });

  it("turns off", async () => {
    expect(await (await DELETE(req("DELETE"))).json()).toEqual({ on: false });
    expect(feeds.revokeFeed).toHaveBeenCalledWith("u1", undefined);
  });

  it("turns off only a link made before a Start over, when told when that was", async () => {
    await DELETE(req("DELETE", { madeBefore: "2026-11-10T12:05:00.000Z" }));
    expect(feeds.revokeFeed).toHaveBeenCalledWith("u1", new Date("2026-11-10T12:05:00.000Z"));
    expect((await DELETE(req("DELETE", { madeBefore: "soon" }))).status).toBe(400);
    expect(feeds.revokeFeed).toHaveBeenCalledTimes(1);
  });

  it("is rate limited per pilot", async () => {
    rate.checkRateLimit.mockResolvedValue({ ok: false });
    expect((await GET()).status).toBe(429);
    expect(rate.checkRateLimit.mock.calls[0][1]).toBe("u1");
  });

  it("makes a link only for a member, once memberships are enforced; one made already can still be turned off", async () => {
    // The calendar feed is a membership feature, but any signed-in pilot with none could make a link.
    membership.enforced = true;
    try {
      auth.getCurrentServerUser.mockResolvedValue({ id: "u1", createdAt: "2027-01-05T00:00:00.000Z", plan: "free", freeMemberAt: null });
      const res = await POST(req("POST", {}));
      expect(res.status).toBe(402);
      expect(feeds.startFeed).not.toHaveBeenCalled();
      await DELETE(req("DELETE"));
      expect(feeds.revokeFeed).toHaveBeenCalled();
      auth.getCurrentServerUser.mockResolvedValue({ id: "u1", createdAt: "2027-01-05T00:00:00.000Z", plan: "free", freeMemberAt: "2027-01-06T00:00:00.000Z" });
      feeds.startFeed.mockResolvedValue({ token: "tok", status: { on: true } });
      expect((await POST(req("POST", {}))).status).toBe(200);
    } finally {
      membership.enforced = false;
    }
  });
});
