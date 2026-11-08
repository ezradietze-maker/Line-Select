import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentServerUser: vi.fn() }));
vi.mock("@/lib/server/auth", () => auth);
const feeds = vi.hoisted(() => ({ feedStatus: vi.fn(), revokeFeed: vi.fn(), setFeedOptions: vi.fn(), startFeed: vi.fn(), syncFeed: vi.fn() }));
vi.mock("@/lib/server/calendar-feeds", () => feeds);
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: rate.checkRateLimit, rateLimitedResponse: () => new Response(null, { status: 429 }) }));

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
    for (const res of [await GET(), await POST(req("POST", {})), await PATCH(req("PATCH", { homeDays: true })), await PUT(req("PUT", choice)), await DELETE()]) expect(res.status).toBe(401);
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
    expect(await (await DELETE()).json()).toEqual({ on: false });
    expect(feeds.revokeFeed).toHaveBeenCalledWith("u1");
  });

  it("is rate limited per pilot", async () => {
    rate.checkRateLimit.mockResolvedValue({ ok: false });
    expect((await GET()).status).toBe(429);
    expect(rate.checkRateLimit.mock.calls[0][1]).toBe("u1");
  });
});
