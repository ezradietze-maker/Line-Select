import { describe, expect, it } from "vitest";
import { LiveFeedNotWiredError } from "@/lib/fedex-connect/fedex-client";
import { liveViewAddSource } from "@/lib/fedex-connect/live-view-add-source";
import { parseOpenTimeList } from "@/lib/view-add";

const ref = { userId: "u1", handle: "h1" };
const LIST = ["213 14OCT", "Trip 37 Oct 15 CH 12.5", "9999 12/31"].join("\n");

describe("live View/Add source", () => {
  it("reads fixture text into the same entries View/Add's own parser would produce", async () => {
    const result = await liveViewAddSource({ ref, fixture: LIST }).read();
    const viaPaste = parseOpenTimeList(LIST);
    expect(result.entries).toEqual(viaPaste.entries);
    expect(result.notRead).toEqual(viaPaste.notRead);
    expect(result.text).toBe(LIST);
    expect(result.origin).toBe("fixture");
  });

  it("stub throws LiveFeedNotWiredError when asked to read live (no fixture)", async () => {
    await expect(liveViewAddSource({ ref }).read()).rejects.toBeInstanceOf(LiveFeedNotWiredError);
  });
});
