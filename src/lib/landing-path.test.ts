import { describe, expect, it } from "vitest";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import { landingAfterSignIn, landingPathFor } from "./landing-path";

const pack = (id: string) => ({ id }) as BidPack;
const profile = {} as PreferenceProfile;

describe("where signing in lands", () => {
  it("sends a guest who was trying the sample pack to upload their own: the account doesn't take the sample", () => {
    // The guest's interview on the sample still comes along, so they'd otherwise have gone to the landing page.
    expect(landingAfterSignIn(null, profile, pack("sample-bidpack"))).toBe("/upload");
    expect(landingAfterSignIn(null, null, pack("sample-bidpack"))).toBe("/upload");
  });

  it("keeps the account's own pack when it has one", () => {
    expect(landingAfterSignIn(pack("MEM-777-CA-NOV26"), profile, pack("sample-bidpack"))).toBe("/results");
  });

  it("is the usual resume point otherwise", () => {
    expect(landingAfterSignIn(pack("MEM-777-CA-NOV26"), null, null)).toBe("/preferences");
    expect(landingAfterSignIn(null, null, null)).toBe("/");
    expect(landingPathFor(pack("MEM-777-CA-NOV26"), profile)).toBe("/results");
  });
});
