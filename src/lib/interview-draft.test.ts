import { describe, expect, it } from "vitest";
import { DRAFT_MAX_AGE_MS, parseDraft, type InterviewDraft } from "@/lib/interview-draft";

const NOW = 1_800_000_000_000;

function draft(over: Partial<InterviewDraft> = {}): InterviewDraft {
  return {
    version: 1,
    bidPackId: "pack-1",
    savedAt: NOW - 60_000,
    isCommuter: true,
    hasCrashPad: false,
    cityPreferences: { HNL: "love" },
    facts: [],
    transcript: [],
    turnsUsed: 4,
    currentQuestion: { id: "q5", kind: "free-text", prompt: "Anything else?" },
    ...over,
  };
}

describe("parseDraft", () => {
  it("returns a fresh, matching draft", () => {
    const d = parseDraft(JSON.stringify(draft()), "pack-1", NOW);
    expect(d?.turnsUsed).toBe(4);
  });

  it("rejects nothing-there, garbage and the wrong version", () => {
    expect(parseDraft(null, "pack-1", NOW)).toBeNull();
    expect(parseDraft("not json", "pack-1", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft(), version: 2 }), "pack-1", NOW)).toBeNull();
  });

  it("rejects a draft from a different bid pack", () => {
    expect(parseDraft(JSON.stringify(draft({ bidPackId: "other" })), "pack-1", NOW)).toBeNull();
  });

  it("rejects a stale draft and one saved in the future", () => {
    expect(parseDraft(JSON.stringify(draft({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 })), "pack-1", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify(draft({ savedAt: NOW + 10_000 })), "pack-1", NOW)).toBeNull();
  });

  it("rejects a draft with no question to resume on", () => {
    const broken = { ...draft(), currentQuestion: undefined };
    expect(parseDraft(JSON.stringify(broken), "pack-1", NOW)).toBeNull();
  });
});
