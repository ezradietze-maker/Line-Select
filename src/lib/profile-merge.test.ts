import { describe, expect, it } from "vitest";
import type { LoggedMonth } from "@/types/logbook";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";
import { mergeAfterConflict } from "./profile-merge";

function profile(logbook: LoggedMonth[] | undefined, completedAt: string): PreferenceProfile {
  return { weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: null, hasCrashPad: null, cityPreferences: {}, completedAt, implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [], logbook };
}

const month = (id: string, loggedAt: string, extra: Partial<LoggedMonth> = {}): LoggedMonth => ({ id, base: "MEM", aircraft: "MD11", seat: "CAP", month: id, outcome: "line", loggedAt, ...extra });

describe("mergeAfterConflict", () => {
  it("keeps the newer copy and every logbook entry from both", () => {
    const newer = profile([month("NOV26", "2026-11-03T00:00:00Z")], "2026-11-05T12:00:00Z");
    const mine = profile([month("OCT26", "2026-10-03T00:00:00Z")], "2026-11-01T00:00:00Z");
    const merged = mergeAfterConflict(newer, mine);
    expect(merged.completedAt).toBe("2026-11-05T12:00:00Z");
    expect(merged.logbook?.map((e) => e.id)).toEqual(["NOV26", "OCT26"]);
  });

  it("keeps the later of two versions of one month", () => {
    const logged = month("NOV26", "2026-11-03T00:00:00Z");
    const checkedIn = { ...logged, checkIn: { feel: "better" as const, at: "2026-12-02T00:00:00Z" } };
    expect(mergeAfterConflict(profile([logged], "b"), profile([checkedIn], "a")).logbook?.[0].checkIn?.feel).toBe("better");
    expect(mergeAfterConflict(profile([checkedIn], "b"), profile([logged], "a")).logbook?.[0].checkIn?.feel).toBe("better");
  });

  it("leaves a profile with no logbook as it was", () => {
    const newer = profile(undefined, "b");
    expect(mergeAfterConflict(newer, profile(undefined, "a"))).toBe(newer);
  });
});
