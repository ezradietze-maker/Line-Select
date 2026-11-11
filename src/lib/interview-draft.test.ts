import { describe, expect, it, vi } from "vitest";
import { adoptGuestDrafts, DRAFT_MAX_AGE_MS, parseDraft, type InterviewDraft } from "@/lib/interview-draft";

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

describe("signing in partway through the interview", () => {
  it("brings the guest's story and answers over to the account, and keeps an account's own draft", () => {
    const items = new Map<string, string>([
      ["line-select:story-draft:guest:v1", "story"],
      ["line-select:brain-interview:guest:pack-1:v1", "answers"],
      ["line-select:brain-interview:guest:pack-2:v1", "guest's"],
      ["line-select:brain-interview:pilot-1:pack-2:v1", "account's"],
    ]);
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
    adoptGuestDrafts("pilot-1");
    vi.unstubAllGlobals();
    expect(items.get("line-select:story-draft:pilot-1:v1")).toBe("story");
    expect(items.get("line-select:brain-interview:pilot-1:pack-1:v1")).toBe("answers");
    expect(items.get("line-select:brain-interview:pilot-1:pack-2:v1")).toBe("account's");
    expect([...items.keys()].some((k) => k.includes(":guest:"))).toBe(false);
  });
});
