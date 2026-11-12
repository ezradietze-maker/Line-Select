import { describe, expect, it } from "vitest";
import type { LoggedMonth } from "@/types/logbook";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";
import { mergeAfterConflict, withGuestRecords } from "./profile-merge";

function profile(logbook: LoggedMonth[] | undefined, completedAt: string): PreferenceProfile {
  return { weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: null, hasCrashPad: null, cityPreferences: {}, completedAt, implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [], logbook };
}

const month = (id: string, loggedAt: string, extra: Partial<LoggedMonth> = {}): LoggedMonth => ({ id, base: "MEM", aircraft: "MD11", seat: "CAP", month: id, outcome: "line", loggedAt, ...extra });

describe("mergeAfterConflict", () => {
  it("keeps an interview this device finished after the one the other copy holds, and what either ticked", () => {
    const other = { ...profile([month("OCT26", "2026-10-03T00:00:00Z")], "2026-10-01T00:00:00Z"), bidChecklist: { oct: { enteredAt: "2026-11-10T00:00:00Z" } } };
    const mine = { ...profile(undefined, "2026-11-12T00:00:00Z"), synopsisMarker: "november check-in" } as PreferenceProfile;
    const merged = mergeAfterConflict(other, mine);
    expect(merged.completedAt).toBe("2026-11-12T00:00:00Z");
    expect((merged as unknown as { synopsisMarker: string }).synopsisMarker).toBe("november check-in");
    expect(merged.bidChecklist).toEqual({ oct: { enteredAt: "2026-11-10T00:00:00Z" } });
    expect(merged.logbook?.map((e) => e.id)).toEqual(["OCT26"]);
  });

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

describe("mergeAfterConflict against the copy the save started from", () => {
  const base = { ...profile(undefined, "2026-11-07T00:00:00Z"), seniorityNumber: null } as PreferenceProfile;

  it("keeps this device's edit when the newer copy changed something else", () => {
    const newer = { ...base, cityRatings: { HNL: { score: 2 } } } as unknown as PreferenceProfile;
    const mine = { ...base, seniorityNumber: 1234, weights: { ...base.weights, daysOff: 90 }, brainInterview: { exchanges: [], choices: [], pins: { "days-off": 1 } } } as unknown as PreferenceProfile;
    const merged = mergeAfterConflict(newer, mine, base);
    expect(merged.seniorityNumber).toBe(1234);
    expect(merged.weights.daysOff).toBe(90);
    expect(merged.brainInterview?.pins).toEqual({ "days-off": 1 });
    expect((merged as unknown as { cityRatings: unknown }).cityRatings).toEqual({ HNL: { score: 2 } });
  });

  it("takes this device's value where both changed the same setting", () => {
    const newer = { ...base, seniorityNumber: 500, minHomeHours: 20 } as PreferenceProfile;
    const mine = { ...base, seniorityNumber: 1234 } as PreferenceProfile;
    const merged = mergeAfterConflict(newer, mine, base);
    expect(merged.seniorityNumber).toBe(1234);
    expect(merged.minHomeHours).toBe(20);
  });

  it("doesn't read the server's reordered keys as an edit", () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as PreferenceProfile;
    const newer = { ...base, seniorityNumber: 500 } as PreferenceProfile;
    expect(mergeAfterConflict(newer, reordered, base).seniorityNumber).toBe(500);
  });

  it("takes a setting this device cleared off the merged copy too", () => {
    const withTarget = { ...base, minHomeHours: 30 } as PreferenceProfile;
    const newer = { ...withTarget, seniorityNumber: 500 } as PreferenceProfile;
    const { minHomeHours: _cleared, ...mine } = withTarget;
    void _cleared;
    const merged = mergeAfterConflict(newer, mine as PreferenceProfile, withTarget);
    expect("minHomeHours" in merged).toBe(false);
    expect(merged.seniorityNumber).toBe(500);
  });

  it("keeps the newer copy as it is when there's no copy to compare against", () => {
    const newer = { ...base, seniorityNumber: 500 } as PreferenceProfile;
    const mine = { ...base, seniorityNumber: 1234 } as PreferenceProfile;
    expect(mergeAfterConflict(newer, mine).seniorityNumber).toBe(500);
    expect(mergeAfterConflict(newer, mine, null)).toBe(newer);
  });

  it("keeps an interview the other device finished since, whole", () => {
    const newer = { ...base, completedAt: "2026-11-09T00:00:00Z", weights: { ...base.weights, daysOff: 10 } } as PreferenceProfile;
    const mine = { ...base, weights: { ...base.weights, daysOff: 90 } } as PreferenceProfile;
    expect(mergeAfterConflict(newer, mine, base).weights.daysOff).toBe(10);
  });

  it("still merges both logbooks with this device's edit kept", () => {
    const newer = { ...base, logbook: [month("NOV26", "2026-11-03T00:00:00Z")] } as PreferenceProfile;
    const mine = { ...base, seniorityNumber: 1234, logbook: [month("OCT26", "2026-10-03T00:00:00Z")] } as PreferenceProfile;
    const merged = mergeAfterConflict(newer, mine, base);
    expect(merged.seniorityNumber).toBe(1234);
    expect(merged.logbook?.map((e) => e.id)).toEqual(["NOV26", "OCT26"]);
  });
});

describe("withGuestRecords", () => {
  it("adds the guest's logged months and checklist to the account's profile and leaves the rest", () => {
    const account = { ...profile([month("SEP26", "2026-09-03T00:00:00Z")], "2026-11-01T00:00:00Z"), seniorityNumber: 900 } as PreferenceProfile;
    const guest = { ...profile([month("OCT26", "2026-10-03T00:00:00Z")], "2026-11-05T00:00:00Z"), seniorityNumber: 5, bidChecklist: { oct: { enteredAt: "2026-10-10T00:00:00Z" } } } as PreferenceProfile;
    const merged = withGuestRecords(account, guest);
    expect(merged.logbook?.map((e) => e.id)).toEqual(["OCT26", "SEP26"]);
    expect(merged.bidChecklist).toEqual({ oct: { enteredAt: "2026-10-10T00:00:00Z" } });
    expect(merged.seniorityNumber).toBe(900);
    expect(merged.completedAt).toBe("2026-11-01T00:00:00Z");
  });

  it("is the account's own profile when the guest logged nothing", () => {
    const account = profile(undefined, "a");
    expect(withGuestRecords(account, profile([], "b"))).toBe(account);
  });
});
