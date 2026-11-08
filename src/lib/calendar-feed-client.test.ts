import { afterEach, describe, expect, it, vi } from "vitest";
const server = vi.hoisted(() => ({ saveServerBidPack: vi.fn() }));
vi.mock("@/lib/bidpack-server", () => server);
import { feedChoiceFor, feedLinks, syncFeedChoice } from "@/lib/calendar-feed-client";
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
    expect(server.saveServerBidPack).toHaveBeenCalledWith(pack);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says so when the pack can't be saved, without sending again", async () => {
    const fetchMock = answers("pack-not-saved");
    server.saveServerBidPack.mockResolvedValue(false);
    expect(await syncFeedChoice(pack, null, "1004")).toBe("pack-not-saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't save anything for a pilot with no link", async () => {
    answers("off");
    expect(await syncFeedChoice(pack, null, "1004")).toBe("off");
    expect(server.saveServerBidPack).not.toHaveBeenCalled();
  });
});
