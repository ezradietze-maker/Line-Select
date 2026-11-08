import { describe, expect, it } from "vitest";
import { feedChoiceFor, feedLinks } from "@/lib/calendar-feed-client";
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
