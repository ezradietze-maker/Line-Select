import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS } from "@/types/preferences";
import type { PreferenceProfile } from "@/types/preferences";

const kvStore = new Map<string, unknown>();

vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => {
    kvStore.set(key, value);
  }),
}));

import {
  createFeedbackSubmission,
  deletePreferenceProfile,
  getPreferenceProfile,
  listFeedbackSubmissions,
  savePreferenceProfile,
} from "@/lib/server/db";
import type { FeedbackSubmission } from "@/types/feedback";

function fakeProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    deepRoundCompleted: false,
    tradeoffAnswers: [],
    explicitTargets: {},
    isCommuter: null,
    hasCrashPad: null,
    cityPreferences: {},
    completedAt: "2026-01-01T00:00:00.000Z",
    implicitWeights: {},
    implicitConfidence: {},
    discoveredFacts: [],
    interviewTranscript: [],
    ...overrides,
  };
}

/**
 * Live-confirmed bug this covers: a pilot's profile used to live only in
 * that browser's localStorage, so it never survived a device change — and
 * separately, the client was nulling it out on every new bid pack
 * confirmation before the "returning pilot" cross-cycle logic in
 * interview-engine.ts ever got a chance to use it (fixed in app-state.tsx).
 * These tests cover the server-side half of the fix: a real, shared store
 * keyed by userId.
 */
describe("preference profile store", () => {
  beforeEach(() => {
    kvStore.clear();
  });

  it("returns null for a pilot who has never saved a profile", async () => {
    expect(await getPreferenceProfile("user-1")).toBeNull();
  });

  it("round-trips a saved profile back out for the same userId", async () => {
    const profile = fakeProfile({ isCommuter: true });
    await savePreferenceProfile("user-1", profile);
    expect(await getPreferenceProfile("user-1")).toEqual(profile);
  });

  it("keeps different pilots' profiles independent", async () => {
    await savePreferenceProfile("user-1", fakeProfile({ isCommuter: true }));
    await savePreferenceProfile("user-2", fakeProfile({ isCommuter: false }));
    expect((await getPreferenceProfile("user-1"))?.isCommuter).toBe(true);
    expect((await getPreferenceProfile("user-2"))?.isCommuter).toBe(false);
  });

  it("overwrites a pilot's own prior profile on a second save, not appending", async () => {
    await savePreferenceProfile("user-1", fakeProfile({ deepRoundCompleted: false }));
    await savePreferenceProfile("user-1", fakeProfile({ deepRoundCompleted: true }));
    expect((await getPreferenceProfile("user-1"))?.deepRoundCompleted).toBe(true);
  });

  it("deletes only the requested pilot's profile", async () => {
    await savePreferenceProfile("user-1", fakeProfile());
    await savePreferenceProfile("user-2", fakeProfile());
    await deletePreferenceProfile("user-1");
    expect(await getPreferenceProfile("user-1")).toBeNull();
    expect(await getPreferenceProfile("user-2")).not.toBeNull();
  });

  it("deleting a profile that was never saved is a harmless no-op", async () => {
    await expect(deletePreferenceProfile("ghost-user")).resolves.toBeUndefined();
  });
});

function fakeFeedback(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    id: "feedback-1",
    pilotId: null,
    pilotDisplayName: null,
    pilotEmail: null,
    category: "idea",
    message: "It would be nice if...",
    page: "/results",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("feedback store", () => {
  beforeEach(() => {
    kvStore.clear();
  });

  it("starts empty", async () => {
    expect(await listFeedbackSubmissions()).toEqual([]);
  });

  it("lists a submission back out after creating it", async () => {
    const submission = fakeFeedback();
    await createFeedbackSubmission(submission);
    expect(await listFeedbackSubmissions()).toEqual([submission]);
  });

  it("never overwrites a prior submission — every one is appended", async () => {
    await createFeedbackSubmission(fakeFeedback({ id: "feedback-1" }));
    await createFeedbackSubmission(fakeFeedback({ id: "feedback-2" }));
    const all = await listFeedbackSubmissions();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.id).sort()).toEqual(["feedback-1", "feedback-2"]);
  });

  it("lists newest first", async () => {
    await createFeedbackSubmission(fakeFeedback({ id: "older", createdAt: "2026-01-01T00:00:00.000Z" }));
    await createFeedbackSubmission(fakeFeedback({ id: "newer", createdAt: "2026-02-01T00:00:00.000Z" }));
    const all = await listFeedbackSubmissions();
    expect(all.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("keeps a guest submission's pilot fields null rather than inventing an identity", async () => {
    await createFeedbackSubmission(fakeFeedback({ pilotId: null, pilotEmail: null }));
    const [saved] = await listFeedbackSubmissions();
    expect(saved.pilotId).toBeNull();
    expect(saved.pilotEmail).toBeNull();
  });
});
