import { describe, expect, it } from "vitest";
import { LiveFeedNotWiredError, readLoggedInList, stubFedexScanner } from "@/lib/fedex-connect/fedex-client";
import { liveOpenTimeSource, snapshotFromLive } from "@/lib/fedex-connect/live-source";
import { parseOpenTimePaste } from "@/lib/open-time/parse";

const ref = { userId: "u1", handle: "h1" };
const LIST = ["213 14OCT", "Trip 37 Oct 15 CH 12.5", "9999 12/31"].join("\n");

describe("live open-time source", () => {
  it("reads fixture text into the same rows the paste parser would produce", async () => {
    const snap = await liveOpenTimeSource({ ref, fixture: LIST }).read();
    const viaPaste = parseOpenTimePaste(LIST);
    expect(snap.rows).toEqual(viaPaste.rows);
    expect(snap.unread).toEqual(viaPaste.unread);
    expect(snap.source).toBe("fixture");
  });

  it("stub scanner throws LiveFeedNotWiredError when asked to read live (no fixture), on either screen", async () => {
    await expect(readLoggedInList(ref, "open-time")).rejects.toBeInstanceOf(LiveFeedNotWiredError);
    await expect(readLoggedInList(ref, "view-add-makeup")).rejects.toBeInstanceOf(LiveFeedNotWiredError);
    await expect(stubFedexScanner.readList(ref, "open-time")).rejects.toBeInstanceOf(LiveFeedNotWiredError);
  });

  it("labels a wired live response 'live'", () => {
    const snap = snapshotFromLive({ screen: "open-time", origin: "live", readAt: 1, text: LIST });
    expect(snap.source).toBe("live");
  });
});
