import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const client = vi.hoisted(() => ({ fetchServerProfile: vi.fn(), saveServerProfile: vi.fn(), clearServerProfile: vi.fn(), serverProfileVersion: vi.fn(), setServerProfileVersion: vi.fn() }));
vi.mock("@/lib/preference-profile-client", () => client);

const local = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) },
});

const { clearProfile, dropGuestRecords, forgetLastKnownProfile, guestProfileChangedElsewhere, hasUnsyncedProfile, loadProfileForUser, saveProfileForUser } = await import("./storage");

const profile = (completedAt: string, logbook: PreferenceProfile["logbook"] = []): PreferenceProfile => ({ weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: null, hasCrashPad: null, seniorityNumber: null, cityPreferences: {}, completedAt, implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [], logbook });
const KEY = "line-select:preference-profile:pilot-1:v1";

beforeEach(() => {
  local.clear();
  forgetLastKnownProfile();
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

  it("keeps a save that still can't get through on the device, marked, rather than taking the server's copy", async () => {
    client.saveServerProfile.mockResolvedValueOnce({ kind: "failed" });
    await saveProfileForUser("pilot-1", profile("logged offline"));
    client.fetchServerProfile.mockResolvedValue({ kind: "found", profile: profile("before") });
    client.saveServerProfile.mockResolvedValueOnce({ kind: "failed" });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("logged offline");
    client.saveServerProfile.mockResolvedValue({ kind: "saved" });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("logged offline");
  });

  it("says a save is still waiting after the app opens and can't send it, so the app keeps retrying and keeps the copy", async () => {
    client.serverProfileVersion.mockReturnValue("v1");
    client.saveServerProfile.mockResolvedValueOnce({ kind: "failed" });
    await saveProfileForUser("pilot-1", profile("logged offline"));
    expect(hasUnsyncedProfile("pilot-1")).toBe(true);
    client.fetchServerProfile.mockResolvedValue({ kind: "found", profile: profile("before") });
    client.saveServerProfile.mockResolvedValueOnce({ kind: "failed" });
    await loadProfileForUser("pilot-1");
    expect(hasUnsyncedProfile("pilot-1")).toBe(true);
    // Sent on a later try: nothing waiting any more.
    client.saveServerProfile.mockResolvedValue({ kind: "saved" });
    await saveProfileForUser("pilot-1", profile("logged offline"));
    expect(hasUnsyncedProfile("pilot-1")).toBe(false);
  });

  it("keeps the version a waiting save was made from when the server can't be reached at all", async () => {
    client.serverProfileVersion.mockReturnValue("v1");
    client.saveServerProfile.mockResolvedValueOnce({ kind: "failed" });
    await saveProfileForUser("pilot-1", profile("logged offline"));
    client.fetchServerProfile.mockResolvedValue({ kind: "unreachable" });
    expect((await loadProfileForUser("pilot-1"))?.completedAt).toBe("logged offline");
    expect(client.setServerProfileVersion).toHaveBeenCalledWith("v1");
    expect(hasUnsyncedProfile("pilot-1")).toBe(true);
  });

  it("marks a failed save with the version it was sent against, after the save ahead of it landed", async () => {
    // Saves run one at a time: the second waits for the first, and the first moves the server's version only when it
    // lands, after the second save has already been asked for.
    let version = "v1";
    client.serverProfileVersion.mockImplementation(() => version);
    let landFirst!: () => void;
    const firstLanded = new Promise<void>((resolve) => {
      landFirst = resolve;
    });
    client.saveServerProfile.mockImplementationOnce(async () => {
      await firstLanded;
      version = "v2";
      return { kind: "saved" };
    });
    client.saveServerProfile.mockImplementationOnce(async () => {
      await firstLanded;
      return { kind: "failed" };
    });
    const first = saveProfileForUser("pilot-1", profile("a"));
    const second = saveProfileForUser("pilot-1", profile("b"));
    // Both asked for and neither landed: a mark taken now would name v1. The second isn't sent until the first is done.
    await vi.waitFor(() => expect(client.saveServerProfile).toHaveBeenCalledTimes(1));
    expect(version).toBe("v1");
    landFirst();
    await Promise.all([first, second]);
    expect(JSON.parse(local.get("line-select:profile-unsynced:pilot-1:v1")!)).toEqual({ base: "v2" });
  });

  it("keeps a guest on this device only", async () => {
    const r = await saveProfileForUser(null, profile("guest"));
    expect(r.sync).toBe("local");
    expect(client.saveServerProfile).not.toHaveBeenCalled();
  });
});

describe("a save refused because another device saved first", () => {
  it("keeps this device's edit and the other device's change, against the copy the save started from", async () => {
    const start = profile("2026-11-07T00:00:00Z");
    client.fetchServerProfile.mockResolvedValue({ kind: "found", profile: start });
    const loaded = (await loadProfileForUser("pilot-1"))!;
    const theirs = { ...start, minHomeHours: 20 };
    client.saveServerProfile.mockResolvedValueOnce({ kind: "conflict", profile: theirs }).mockResolvedValueOnce({ kind: "saved" });
    const r = await saveProfileForUser("pilot-1", { ...loaded, seniorityNumber: 1234 });
    expect(r.sync).toBe("merged");
    expect(r.profile.seniorityNumber).toBe(1234);
    expect(r.profile.minHomeHours).toBe(20);
    // Saved, the merged copy is what the next refused save is compared against.
    client.saveServerProfile.mockResolvedValueOnce({ kind: "conflict", profile: { ...r.profile, hasCrashPad: true } }).mockResolvedValueOnce({ kind: "saved" });
    const again = await saveProfileForUser("pilot-1", { ...r.profile, isCommuter: true });
    expect(again.profile).toMatchObject({ seniorityNumber: 1234, minHomeHours: 20, hasCrashPad: true, isCommuter: true });
  });

  it("writes nothing back to the device once the pilot has signed out", async () => {
    let refuse!: (v: unknown) => void;
    client.saveServerProfile.mockImplementationOnce(() => new Promise((resolve) => (refuse = resolve)));
    const saving = saveProfileForUser("pilot-1", profile("mine"));
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));
    clearProfile("pilot-1");
    refuse({ kind: "conflict", profile: profile("theirs") });
    await saving;
    expect(local.has(KEY)).toBe(false);
    expect(hasUnsyncedProfile("pilot-1")).toBe(false);
  });
});

describe("a guest with two tabs open", () => {
  const GUEST = "line-select:preference-profile:guest:v1";
  const logged = { id: "OCT26", base: "MEM", aircraft: "MD11", seat: "CAP" as const, month: "OCT26", outcome: "line" as const, loggedAt: "2026-10-03T00:00:00Z" };

  it("keeps a month logged in the other tab when this one saves an edit", async () => {
    local.set(GUEST, JSON.stringify(profile("2026-11-07T00:00:00Z")));
    const mine = (await loadProfileForUser(null))!;
    // The other tab logs a month.
    local.set(GUEST, JSON.stringify({ ...mine, logbook: [logged] }));
    const r = await saveProfileForUser(null, { ...mine, seniorityNumber: 1234 });
    expect(r.sync).toBe("local");
    expect(r.profile.logbook?.map((e) => e.id)).toEqual(["OCT26"]);
    expect(r.profile.seniorityNumber).toBe(1234);
    expect(JSON.parse(local.get(GUEST)!)).toMatchObject({ seniorityNumber: 1234, logbook: [{ id: "OCT26" }] });
  });

  it("saves this tab's copy as it is when no other tab changed it", async () => {
    local.set(GUEST, JSON.stringify(profile("2026-11-07T00:00:00Z")));
    const mine = (await loadProfileForUser(null))!;
    const edited = { ...mine, seniorityNumber: 1234 };
    expect((await saveProfileForUser(null, edited)).profile).toBe(edited);
  });

  it("gives up its logged months and checklist once an account holds them, and keeps the rest", () => {
    local.set(GUEST, JSON.stringify({ ...profile("2026-11-07T00:00:00Z", [logged]), seniorityNumber: 77, bidChecklist: { oct: { enteredAt: "x" } } }));
    dropGuestRecords();
    const kept = JSON.parse(local.get(GUEST)!);
    expect(kept.logbook).toBeUndefined();
    expect(kept.bidChecklist).toBeUndefined();
    expect(kept.seniorityNumber).toBe(77);
  });

  it("hands an idle tab the other tab's change once", async () => {
    local.set(GUEST, JSON.stringify(profile("2026-11-07T00:00:00Z")));
    const mine = (await loadProfileForUser(null))!;
    expect(guestProfileChangedElsewhere()).toBeNull();
    local.set(GUEST, JSON.stringify({ ...mine, logbook: [logged] }));
    expect(guestProfileChangedElsewhere()?.logbook?.map((e) => e.id)).toEqual(["OCT26"]);
    expect(guestProfileChangedElsewhere()).toBeNull();
  });
});
