import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPilotOnDevice } from "./device-data";
import { clearFeedbackDraft, loadFeedbackDraft, saveFeedbackDraft } from "./feedback-draft";

const items = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  },
});

beforeEach(() => items.clear());

describe("a half-typed feedback message", () => {
  it("is there again when the dialog reopens, and gone once sent", () => {
    saveFeedbackDraft("pilot-1", { category: "bug", message: "The calendar skipped a day" });
    expect(loadFeedbackDraft("pilot-1")).toEqual({ category: "bug", message: "The calendar skipped a day" });
    clearFeedbackDraft("pilot-1");
    expect(loadFeedbackDraft("pilot-1")).toBeNull();
  });

  it("is kept for the pilot who wrote it, not the next one signed in here", () => {
    saveFeedbackDraft("pilot-1", { category: "idea", message: "mine" });
    expect(loadFeedbackDraft("pilot-2")).toBeNull();
    expect(loadFeedbackDraft(null)).toBeNull();
  });

  it("isn't kept once the message is emptied", () => {
    saveFeedbackDraft(null, { category: "idea", message: "half" });
    saveFeedbackDraft(null, { category: "idea", message: "  " });
    expect(loadFeedbackDraft(null)).toBeNull();
  });

  it("goes with everything else of theirs when they sign out", () => {
    saveFeedbackDraft("pilot-1", { category: "other", message: "their own words" });
    forgetPilotOnDevice("pilot-1");
    expect(loadFeedbackDraft("pilot-1")).toBeNull();
  });
});
