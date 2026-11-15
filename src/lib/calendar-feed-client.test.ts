import { afterEach, describe, expect, it, vi } from "vitest";
const server = vi.hoisted(() => ({ saveServerBidPack: vi.fn(), fetchServerBidPackMeta: vi.fn(async () => null as { packId: string; savedAt: number } | null) }));
vi.mock("@/lib/bidpack-server", () => server);
import { feedChoiceFor, feedLinks, makeFeedLink, MembershipNeededError, payFeedOffOwed, syncFeedChoice, turnOffFeedForStartOver } from "@/lib/calendar-feed-client";
import { feedOffOwed } from "@/lib/calendar-feed-owed";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const pack = { id: "p", base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26" } as BidPack;
const logged = (over: object) => ({ logbook: [{ id: "x", bidPackId: "p", base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26", loggedAt: "", ...over }] }) as unknown as PreferenceProfile;

describe("feedLinks", () => {
  const url = "https://lineselect.test/api/calendar/abc.ics";

  it("gives Apple the webcal link, and Google and Outlook the link each expects", () => {
    const links = feedLinks(url);
    expect(links.apple).toBe("webcal://lineselect.test/api/calendar/abc.ics");
    expect(new URL(links.google).searchParams.get("cid")).toBe("webcal://lineselect.test/api/calendar/abc.ics");
    expect(new URL(links.outlook).searchParams.get("url")).toBe(url);
  });
});

describe("feedChoiceFor", () => {
  it("follows the #1 until an award is logged", () => {
    expect(feedChoiceFor(pack, null, "1004")).toEqual({ lineNumber: "1004", lineSource: "top" });
  });

  it("shows the award once it's logged, whatever is #1 now", () => {
    expect(feedChoiceFor(pack, logged({ outcome: "line", lineNumber: "1005" }), "1004")).toEqual({ lineNumber: "1005", lineSource: "awarded" });
  });

  it("shows no line for an award that wasn't one", () => {
    expect(feedChoiceFor(pack, logged({ outcome: "reserve" }), "1004")).toEqual({ lineNumber: null, lineSource: "awarded" });
  });

  it("has nothing to send with no award and no #1", () => {
    expect(feedChoiceFor(pack, null, null)).toBeNull();
  });
});

describe("syncFeedChoice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function answers(...results: string[]) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: results.shift() })));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends the line, and saves nothing when the account has the pack", async () => {
    const fetchMock = answers("ok");
    expect(await syncFeedChoice(pack, null, "1004")).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(server.saveServerBidPack).not.toHaveBeenCalled();
  });

  it("saves a pack that never reached the account, then sends again", async () => {
    const fetchMock = answers("pack-not-saved", "ok");
    server.saveServerBidPack.mockResolvedValue(true);
    expect(await syncFeedChoice(pack, null, "1004")).toBe("ok");
    expect(server.saveServerBidPack).toHaveBeenCalledWith(pack, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says so when the pack can't be saved, without sending again", async () => {
    const fetchMock = answers("pack-not-saved");
    server.saveServerBidPack.mockResolvedValue(false);
    expect(await syncFeedChoice(pack, null, "1004")).toBe("pack-not-saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't put back an older pack over a newer one the account holds", async () => {
    const fetchMock = answers("pack-not-saved");
    server.fetchServerBidPackMeta.mockResolvedValueOnce({ packId: "newer", savedAt: Date.now() });
    expect(await syncFeedChoice(pack, null, "1004", "u1")).toBe("pack-not-saved");
    expect(server.saveServerBidPack).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't save anything for a pilot with no link", async () => {
    answers("off");
    expect(await syncFeedChoice(pack, null, "1004")).toBe("off");
    expect(server.saveServerBidPack).not.toHaveBeenCalled();
  });
});

describe("Start over turning the calendar link off", () => {
  const kept = new Map<string, string>();
  afterEach(() => {
    vi.unstubAllGlobals();
    kept.clear();
  });
  function device(...replies: (number | "offline")[]) {
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) } });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const r = replies.shift() ?? 200;
      if (r === "offline") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(init?.method === "POST" ? { on: true } : { on: false }), { status: r });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("asks again after a failure, until the server says it's off", async () => {
    const fetchMock = device("offline", 503, 200);
    // No signal as the pilot starts over: once, and the link went on showing the deleted ranking's #1.
    expect(await turnOffFeedForStartOver("u1")).toBe(false);
    expect(feedOffOwed()).toBe("u1");
    expect(await payFeedOffOwed("u1")).toBe(false);
    expect(await payFeedOffOwed("u1")).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["DELETE", "DELETE", "DELETE"]);
    expect(feedOffOwed()).toBeNull();
    // Nothing owed: nothing sent.
    expect(await payFeedOffOwed("u1")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("is only another account's to pay when it's theirs, and a new link the pilot makes drops it", async () => {
    const fetchMock = device("offline");
    await turnOffFeedForStartOver("u1");
    expect(await payFeedOffOwed("u2")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { setShownAccount } = await import("@/lib/shown-account");
    setShownAccount("u1");
    await makeFeedLink();
    expect(feedOffOwed()).toBeNull();
    expect(await payFeedOffOwed("u1")).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["DELETE", "POST"]);
    setShownAccount(null);
  });

  it("turns off whatever link there is on the Start over's own try, whatever this device's clock says", async () => {
    // A clock five minutes slow named a time before a link made a minute ago: the server kept it on, and said "off".
    vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
    const fetchMock = device(200);
    expect(await turnOffFeedForStartOver("u1")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    vi.useRealTimers();
  });

  it("says when it was owed, so a link made since on another device stays on", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-10T12:05:00Z"), toFake: ["Date"] });
    const fetchMock = device("offline", 200);
    await turnOffFeedForStartOver("u1");
    vi.setSystemTime(new Date("2026-11-10T13:00:00Z"));
    await payFeedOffOwed("u1");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ madeBefore: "2026-11-10T12:05:00.000Z" });
    vi.useRealTimers();
  });
});

describe("making a link without a membership", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says it's the membership, with the server's words, so the box can point to it rather than say try again", async () => {
    // Only once FREE_FOR_ALL is off: the server's `accessRefusal`.
    const words = "A Line Select membership unlocks this. Start yours to carry on.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: words, upgrade: "/membership" }), { status: 402 })));
    const refused = await makeFeedLink().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(MembershipNeededError);
    expect((refused as Error).message).toBe(words);
    // Any other failure is still a plain one.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "busy" }), { status: 503 })));
    expect(await makeFeedLink().catch((e: unknown) => e)).not.toBeInstanceOf(MembershipNeededError);
  });
});
