import ICAL from "ical.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedMonth } from "@/lib/calendar-feed";

const feeds = vi.hoisted(() => ({ feedForToken: vi.fn() }));
vi.mock("@/lib/server/calendar-feeds", async (original) => ({ ...(await original<typeof import("@/lib/server/calendar-feeds")>()), feedForToken: feeds.feedForToken }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: rate.checkRateLimit, clientIp: () => "203.0.113.9", rateLimitedResponse: () => new Response(null, { status: 429 }) }));
const paid = vi.hoisted(() => ({ answerTravelNeeds: vi.fn() }));
vi.mock("@/lib/server/flight-schedules", () => ({ answerTravelNeeds: paid.answerTravelNeeds, flightDataConfigured: () => true }));

import { GET } from "./route";

const TOKEN = "a".repeat(43);
const call = (token: string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://x.test/api/calendar/${token}`, { headers }), { params: Promise.resolve({ token }) });

const month: FeedMonth = {
  packId: "p",
  month: "OCT26",
  builtAt: Date.UTC(2026, 8, 1),
  lineNumber: "1004",
  lineSource: "awarded",
  trips: [{ uid: "trip-OCT26-27-20260930@lineselect", start: Date.UTC(2026, 8, 30, 14), end: Date.UTC(2026, 9, 2, 17), summary: "Trip 27: NRT", description: "Hotel: A, B" }],
  homeDays: [{ uid: "home-OCT26-2026-09-28@lineselect", start: "2026-09-28", end: "2026-09-30" }],
  timeline: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  rate.checkRateLimit.mockResolvedValue({ ok: true });
  feeds.feedForToken.mockResolvedValue({ months: [month], options: { homeDays: false } });
});

describe("GET /api/calendar/[token]", () => {
  it("serves the calendar, accepting the .ics ending calendar apps like to see", async () => {
    const res = await call(`${TOKEN}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    // A refresh has to see a new #1: nothing may reuse an old copy without asking.
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    const events = new ICAL.Component(ICAL.parse(await res.text())).getAllSubcomponents("vevent");
    expect(events.map((e) => new ICAL.Event(e).summary)).toEqual(["Trip 27: NRT"]);
    expect(feeds.feedForToken).toHaveBeenCalledWith(TOKEN);
  });

  it("includes Home days only under that option", async () => {
    feeds.feedForToken.mockResolvedValue({ months: [month], options: { homeDays: true } });
    expect(await (await call(TOKEN)).text()).toContain("SUMMARY:Home");
  });

  it("gives a revoked or unknown link a 404, with nothing about why", async () => {
    feeds.feedForToken.mockResolvedValue(null);
    const res = await call(TOKEN);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("gives a 404 to something that isn't a token, without touching the database", async () => {
    expect((await call("short")).status).toBe(404);
    expect((await call("a".repeat(42) + "!")).status).toBe(404);
    expect(feeds.feedForToken).not.toHaveBeenCalled();
  });

  it("limits each link, counting it by its hash", async () => {
    rate.checkRateLimit.mockResolvedValue({ ok: false });
    expect((await call(TOKEN)).status).toBe(429);
    expect(feeds.feedForToken).not.toHaveBeenCalled();
    expect(rate.checkRateLimit.mock.calls.every((c) => !String(c[1]).includes(TOKEN))).toBe(true);
  });

  it("limits each address too, as every guess at a link is a new link", async () => {
    rate.checkRateLimit.mockImplementation(async (bucket: string) => ({ ok: bucket !== "calendar-feed:address" }));
    expect((await call("b".repeat(43))).status).toBe(429);
    expect(feeds.feedForToken).not.toHaveBeenCalled();
  });

  it("answers 304 when the calendar already has this version", async () => {
    const etag = (await call(TOKEN)).headers.get("etag")!;
    expect((await call(TOKEN, { "if-none-match": etag })).status).toBe(304);
    feeds.feedForToken.mockResolvedValue({ months: [{ ...month, trips: [] }], options: { homeDays: false } });
    expect((await call(TOKEN, { "if-none-match": etag })).status).toBe(200);
  });

  it("says try again when the database is down, so a calendar keeps what it has", async () => {
    feeds.feedForToken.mockRejectedValue(new Error("down"));
    expect((await call(TOKEN)).status).toBe(503);
  });

  it("never pays for a lookup on a refresh", async () => {
    await call(TOKEN);
    expect(paid.answerTravelNeeds).not.toHaveBeenCalled();
  });
});
