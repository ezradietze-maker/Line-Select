import { describe, expect, it } from "vitest";
import { LiveFeedNotWiredError, fetchLiveOpenTime, snapshotFromLive, stubFedexClient } from "@/lib/fedex-connect/fedex-client";
import { liveOpenTimeSource } from "@/lib/fedex-connect/live-source";
import { parseOpenTimePaste } from "@/lib/open-time/parse";

const ref = { userId: "u1", handle: "h1" };
const LIST = ["213 14OCT", "Trip 37 Oct 15 CH 12.5", "9999 12/31"].join("\n");

describe("live source", () => {
  it("reads fixture text into the same rows the paste parser would produce", async () => {
    const snap = await liveOpenTimeSource({ ref, fixture: LIST }).read();
    const viaPaste = parseOpenTimePaste(LIST);
    expect(snap.rows).toEqual(viaPaste.rows);
    expect(snap.unread).toEqual(viaPaste.unread);
    expect(snap.source).toBe("fixture");
  });

  it("stub throws LiveFeedNotWiredError when asked to read live (no fixture)", async () => {
    await expect(fetchLiveOpenTime(ref)).rejects.toBeInstanceOf(LiveFeedNotWiredError);
    await expect(stubFedexClient.fetchLiveOpenTime(ref)).rejects.toBeInstanceOf(LiveFeedNotWiredError);
  });

  it("labels a wired live response 'live'", () => {
    const snap = snapshotFromLive({ origin: "live", readAt: 1, text: LIST });
    expect(snap.source).toBe("live");
  });
});
