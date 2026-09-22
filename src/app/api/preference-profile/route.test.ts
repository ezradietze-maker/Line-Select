import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS } from "@/types/preferences";
import type { PreferenceProfile } from "@/types/preferences";

const authMocks = vi.hoisted(() => ({ getCurrentServerUser: vi.fn() }));
vi.mock("@/lib/server/auth", () => authMocks);

const dbMocks = vi.hoisted(() => ({
  getPreferenceProfile: vi.fn(),
  savePreferenceProfile: vi.fn(),
  deletePreferenceProfile: vi.fn(),
}));
vi.mock("@/lib/server/db", () => dbMocks);

import { DELETE, GET, PUT } from "./route";

function fakeProfile(): PreferenceProfile {
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
  };
}

const SIGNED_IN_USER = { id: "user-1", email: "pilot@example.com", displayName: "Pilot", createdAt: "", plan: "free" as const };

describe("/api/preference-profile", () => {
  beforeEach(() => {
    authMocks.getCurrentServerUser.mockReset();
    dbMocks.getPreferenceProfile.mockReset();
    dbMocks.savePreferenceProfile.mockReset().mockResolvedValue(undefined);
    dbMocks.deletePreferenceProfile.mockReset().mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("401s a signed-out request rather than leaking any profile", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
      expect(dbMocks.getPreferenceProfile).not.toHaveBeenCalled();
    });

    it("returns the signed-in pilot's own profile, keyed by their real server-verified id", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const profile = fakeProfile();
      dbMocks.getPreferenceProfile.mockResolvedValue(profile);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ profile });
      expect(dbMocks.getPreferenceProfile).toHaveBeenCalledWith("user-1");
    });

    it("returns a null profile (not an error) for a signed-in pilot who's never saved one", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      dbMocks.getPreferenceProfile.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ profile: null });
    });
  });

  describe("PUT", () => {
    it("401s a signed-out save", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(null);
      const res = await PUT(new Request("http://test", { method: "PUT", body: JSON.stringify({ profile: fakeProfile() }) }));
      expect(res.status).toBe(401);
      expect(dbMocks.savePreferenceProfile).not.toHaveBeenCalled();
    });

    it("rejects a request with no profile in the body", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const res = await PUT(new Request("http://test", { method: "PUT", body: JSON.stringify({}) }));
      expect(res.status).toBe(400);
      expect(dbMocks.savePreferenceProfile).not.toHaveBeenCalled();
    });

    it("saves the profile under the signed-in user's own id, never a client-supplied one", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const profile = fakeProfile();
      const res = await PUT(
        new Request("http://test", { method: "PUT", body: JSON.stringify({ profile, userId: "someone-else" }) })
      );
      expect(res.status).toBe(200);
      expect(dbMocks.savePreferenceProfile).toHaveBeenCalledWith("user-1", profile);
    });
  });

  describe("DELETE", () => {
    it("401s a signed-out clear", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(null);
      const res = await DELETE();
      expect(res.status).toBe(401);
      expect(dbMocks.deletePreferenceProfile).not.toHaveBeenCalled();
    });

    it("clears only the signed-in pilot's own profile", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const res = await DELETE();
      expect(res.status).toBe(200);
      expect(dbMocks.deletePreferenceProfile).toHaveBeenCalledWith("user-1");
    });
  });
});
