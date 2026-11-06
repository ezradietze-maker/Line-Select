import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS } from "@/types/preferences";
import type { PreferenceProfile } from "@/types/preferences";

const authMocks = vi.hoisted(() => ({ getCurrentServerUser: vi.fn() }));
vi.mock("@/lib/server/auth", () => authMocks);

const dbMocks = vi.hoisted(() => ({
  getPreferenceProfileRecord: vi.fn(),
  savePreferenceProfile: vi.fn(),
  savePreferenceProfileOver: vi.fn(),
  deletePreferenceProfile: vi.fn(),
}));
vi.mock("@/lib/server/db", () => dbMocks);
const historyMocks = vi.hoisted(() => ({ keepReplacedVersion: vi.fn() }));
vi.mock("@/lib/server/profile-history", () => historyMocks);
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));

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
    dbMocks.getPreferenceProfileRecord.mockReset().mockResolvedValue(null);
    dbMocks.savePreferenceProfile.mockReset().mockResolvedValue(undefined);
    dbMocks.savePreferenceProfileOver.mockReset();
    historyMocks.keepReplacedVersion.mockReset().mockResolvedValue(undefined);
    dbMocks.deletePreferenceProfile.mockReset().mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("401s a signed-out request rather than leaking any profile", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
      expect(dbMocks.getPreferenceProfileRecord).not.toHaveBeenCalled();
    });

    it("returns the signed-in pilot's own profile, keyed by their real server-verified id", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const profile = fakeProfile();
      dbMocks.getPreferenceProfileRecord.mockResolvedValue({ profile, updatedAt: "2026-11-05T10:00:00.000Z" });
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ profile, updatedAt: "2026-11-05T10:00:00.000Z" });
      expect(dbMocks.getPreferenceProfileRecord).toHaveBeenCalledWith("user-1");
    });

    it("returns a null profile (not an error) for a signed-in pilot who's never saved one", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ profile: null, updatedAt: null });
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

    it("saves over the version the device last saw, and keeps the one it replaced", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const previous = { profile: fakeProfile(), updatedAt: "2026-11-05T10:00:00.000Z" };
      dbMocks.getPreferenceProfileRecord.mockResolvedValue(previous);
      dbMocks.savePreferenceProfileOver.mockResolvedValue({ saved: true, updatedAt: "2026-11-05T11:00:00.000Z" });
      const profile = fakeProfile();
      const res = await PUT(new Request("http://test", { method: "PUT", body: JSON.stringify({ profile, baseUpdatedAt: previous.updatedAt }) }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, updatedAt: "2026-11-05T11:00:00.000Z" });
      expect(dbMocks.savePreferenceProfileOver).toHaveBeenCalledWith("user-1", profile, previous.updatedAt);
      expect(historyMocks.keepReplacedVersion).toHaveBeenCalledWith("user-1", previous);
    });

    it("refuses a save made from an older copy, and hands back the newer one", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const newer = { profile: { ...fakeProfile(), completedAt: "2026-11-05T12:00:00.000Z" }, updatedAt: "2026-11-05T12:00:00.000Z" };
      dbMocks.getPreferenceProfileRecord.mockResolvedValue(newer);
      dbMocks.savePreferenceProfileOver.mockResolvedValue({ saved: false, current: newer });
      const res = await PUT(new Request("http://test", { method: "PUT", body: JSON.stringify({ profile: fakeProfile(), baseUpdatedAt: "2026-11-05T10:00:00.000Z" }) }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ profile: newer.profile, updatedAt: newer.updatedAt });
      expect(historyMocks.keepReplacedVersion).not.toHaveBeenCalled();
    });

    it("answers 503, not a crash, when the database is down", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      dbMocks.getPreferenceProfileRecord.mockRejectedValue(new Error("connection refused"));
      const res = await PUT(new Request("http://test", { method: "PUT", body: JSON.stringify({ profile: fakeProfile(), baseUpdatedAt: null }) }));
      expect(res.status).toBe(503);
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
