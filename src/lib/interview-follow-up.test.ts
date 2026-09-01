import { describe, expect, it } from "vitest";
import { FOLLOW_UP_THRESHOLD, MAX_FOLLOW_UPS, followUpContextFor, shouldOfferFollowUp } from "@/lib/interview-follow-up";
import type { SliderQuestionConfig } from "@/lib/interview-config";

const CONFIG: SliderQuestionConfig = {
  key: "tripLength",
  question: "Short trips or long trips?",
  lowLabel: "Prefer short trips",
  highLabel: "Prefer long trips",
  centerLabel: "No strong preference",
};

describe("shouldOfferFollowUp", () => {
  it("does not offer below the threshold", () => {
    expect(shouldOfferFollowUp("tripLength", FOLLOW_UP_THRESHOLD - 1, new Set())).toBe(false);
    expect(shouldOfferFollowUp("tripLength", -(FOLLOW_UP_THRESHOLD - 1), new Set())).toBe(false);
  });

  it("offers once a slider crosses the threshold in either direction", () => {
    expect(shouldOfferFollowUp("tripLength", FOLLOW_UP_THRESHOLD, new Set())).toBe(true);
    expect(shouldOfferFollowUp("tripLength", -FOLLOW_UP_THRESHOLD, new Set())).toBe(true);
  });

  it("never offers twice for the same key", () => {
    expect(shouldOfferFollowUp("tripLength", 100, new Set(["tripLength"]))).toBe(false);
  });

  it("stops offering once the session cap is reached, even for an unseen key", () => {
    const shown = new Set(Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => `key-${i}`));
    expect(shouldOfferFollowUp("brand-new-key", 100, shown)).toBe(false);
  });

  it("still allows a new key right up to the cap", () => {
    const shown = new Set(Array.from({ length: MAX_FOLLOW_UPS - 1 }, (_, i) => `key-${i}`));
    expect(shouldOfferFollowUp("brand-new-key", 100, shown)).toBe(true);
  });
});

describe("followUpContextFor", () => {
  it("names the high label when the pilot leaned positive", () => {
    const context = followUpContextFor(CONFIG, 90);
    expect(context).toContain(CONFIG.question);
    expect(context).toContain(CONFIG.highLabel);
    expect(context).not.toContain(CONFIG.lowLabel);
  });

  it("names the low label when the pilot leaned negative", () => {
    const context = followUpContextFor(CONFIG, -90);
    expect(context).toContain(CONFIG.lowLabel);
    expect(context).not.toContain(CONFIG.highLabel);
  });
});
