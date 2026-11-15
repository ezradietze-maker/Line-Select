import { describe, expect, it } from "vitest";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import { landingAfterSignIn, landingPathFor, sampleWouldReplace } from "./landing-path";

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

describe("trying the sample with a pack loaded", () => {
  it("asks first when it would take the place of the pilot's own pack", () => {
    // Back to the landing page after uploading and ranking: one tap on "Try it with sample data" saved the sample over
    // their pack, and it was gone until they uploaded the PDF again.
    expect(sampleWouldReplace(pack("uploaded-mem-md11-cap-oct26"))).toBe(true);
  });

  it("just loads it with no pack, or the sample already", () => {
    expect(sampleWouldReplace(null)).toBe(false);
    expect(sampleWouldReplace(pack("sample-bidpack"))).toBe(false);
  });
});
