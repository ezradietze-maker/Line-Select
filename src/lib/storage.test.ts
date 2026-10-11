import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadProfile, saveProfile } from "@/lib/storage";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe("profile storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("keeps every saved field through a reload, not just the ones it backfills", () => {
    const profile: PreferenceProfile = {
      weights: { ...DEFAULT_WEIGHTS },
      deepRoundCompleted: false,
      tradeoffAnswers: [],
      explicitTargets: { daysOff: 15 },
      targetImportance: { daysOff: 0.9 },
      isCommuter: true,
      commuteFrom: "SAN",
      hasCrashPad: false,
      cityPreferences: { HNL: "love" },
      cityRatings: { HNL: { score: 2, reasons: ["food"] } },
      completedAt: "2026-10-10T00:00:00.000Z",
      implicitWeights: {},
      implicitConfidence: {},
      discoveredFacts: [],
      interviewTranscript: [],
    };
    expect(saveProfile("u1", profile)).toBe(true);
    const back = loadProfile("u1")!;
    expect(back.commuteFrom).toBe("SAN");
    expect(back.targetImportance).toEqual({ daysOff: 0.9 });
    expect(back.cityRatings).toEqual({ HNL: { score: 2, reasons: ["food"] } });
  });

  it("still backfills what an old profile never had", () => {
    window.localStorage.setItem("line-select:preference-profile:guest:v1", JSON.stringify({ weights: {} }));
    const back = loadProfile(null)!;
    expect(back.cityPreferences).toEqual({});
    expect(back.discoveredFacts).toEqual([]);
    expect(back.weights).toEqual(DEFAULT_WEIGHTS);
  });
});
