import { describe, expect, it } from "vitest";
import { pendingAfterLoading } from "@/lib/pending-profile-storage";
import type { PreferenceProfile } from "@/types/preferences";

describe("an unconfirmed interview when a pack is loaded", () => {
  const pending = { weights: {} } as PreferenceProfile;

  it("stays for the same pack uploaded again", () => {
    expect(pendingAfterLoading(pending, "uploaded-mem-md11-cap-nov26", "uploaded-mem-md11-cap-nov26")).toBe(pending);
  });

  it("goes with another pack, or with none loaded before", () => {
    expect(pendingAfterLoading(pending, "uploaded-mem-md11-cap-nov26", "uploaded-mem-md11-cap-dec26")).toBeNull();
    expect(pendingAfterLoading(pending, null, "uploaded-mem-md11-cap-nov26")).toBeNull();
    expect(pendingAfterLoading(null, "uploaded-mem-md11-cap-nov26", "uploaded-mem-md11-cap-nov26")).toBeNull();
  });
});
