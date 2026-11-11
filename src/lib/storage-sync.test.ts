import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const client = vi.hoisted(() => ({ fetchServerProfile: vi.fn(), saveServerProfile: vi.fn(), clearServerProfile: vi.fn(), serverProfileVersion: vi.fn(), setServerProfileVersion: vi.fn() }));
vi.mock("@/lib/preference-profile-client", () => client);

const local = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) },
});

const { loadProfileForUser, saveProfileForUser } = await import("./storage");

const profile = (completedAt: string, logbook: PreferenceProfile["logbook"] = []): PreferenceProfile => ({ weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: null, hasCrashPad: null, seniorityNumber: null, cityPreferences: {}, completedAt, implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [], logbook });
const KEY = "line-select:preference-profile:pilot-1:v1";

beforeEach(() => {
  local.clear();
  for (const f of Object.values(client)) f.mockReset();
  client.saveServerProfile.mockResolvedValue({ kind: "saved" });
});

describe("loading a signed-in pilot's profile", () => {
  it("uses the device's copy without uploading it when the server can't be reached", async () => {
    local.set(KEY, JSON.stringify(profile("old")));
    client.fetchServerProfile.mockResolvedValue({ kind: "unreachable" });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("old");
    expect(client.saveServerProfile).not.toHaveBeenCalled();
  });

  it("uploads the device's copy only when the server has none", async () => {
    local.set(KEY, JSON.stringify(profile("only-here")));
    client.fetchServerProfile.mockResolvedValue({ kind: "none" });
    await loadProfileForUser("pilot-1");
    expect(client.saveServerProfile).toHaveBeenCalledTimes(1);
  });

  it("prefers the server's copy and refreshes the device with it", async () => {
    local.set(KEY, JSON.stringify(profile("old")));
    client.fetchServerProfile.mockResolvedValue({ kind: "found", profile: profile("server") });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("server");
    expect(JSON.parse(local.get(KEY)!).completedAt).toBe("server");
  });
});

describe("saving a signed-in pilot's profile", () => {
  it("says when the account save didn't get through", async () => {
    client.saveServerProfile.mockResolvedValue({ kind: "failed" });
    const r = await saveProfileForUser("pilot-1", profile("mine"));
    expect(r).toMatchObject({ savedLocally: true, sync: "failed" });
  });

  it("merges with a newer copy from another device, keeps both logbooks, and saves that", async () => {
    const theirs = profile("theirs", [{ id: "NOV26", base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26", outcome: "line", loggedAt: "2026-11-03T00:00:00Z" }]);
    const mine = profile("mine", [{ id: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP", month: "OCT26", outcome: "line", loggedAt: "2026-10-03T00:00:00Z" }]);
    client.saveServerProfile.mockResolvedValueOnce({ kind: "conflict", profile: theirs }).mockResolvedValueOnce({ kind: "saved" });
    const r = await saveProfileForUser("pilot-1", mine);
    expect(r.sync).toBe("merged");
    expect(r.profile.completedAt).toBe("theirs");
    expect(r.profile.logbook?.map((e) => e.id)).toEqual(["NOV26", "OCT26"]);
    expect(client.saveServerProfile).toHaveBeenLastCalledWith(r.profile);
  });

  it("sends a save kept on this device, next time the app opens, rather than replacing it with the older copy", async () => {
    client.serverProfileVersion.mockReturnValue("v1");
    client.saveServerProfile.mockResolvedValueOnce({ kind: "failed" });
    await saveProfileForUser("pilot-1", profile("logged offline"));
    client.fetchServerProfile.mockResolvedValue({ kind: "found", profile: profile("before") });
    client.saveServerProfile.mockResolvedValue({ kind: "saved" });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("logged offline");
    expect(client.setServerProfileVersion).toHaveBeenCalledWith("v1");
    // Sent, so the next open takes the server's copy as usual.
    client.fetchServerProfile.mockResolvedValue({ kind: "found", profile: profile("later, from another device") });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("later, from another device");
  });

  it("keeps a guest on this device only", async () => {
    const r = await saveProfileForUser(null, profile("guest"));
    expect(r.sync).toBe("local");
    expect(client.saveServerProfile).not.toHaveBeenCalled();
  });
});
