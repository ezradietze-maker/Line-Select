// The signed-in save flow end to end: the real client and storage against a fake server that checks versions as
// /api/preference-profile does.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const local = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) },
});

/** `failPut`: the numbers (1 = first) of the PUTs from now on that fail with a 503. */
const server = { profile: null as PreferenceProfile | null, version: 0, puts: 0, failPut: new Set<number>() };
vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  const answer = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
  if (!init?.method || init.method === "GET") return answer({ profile: server.profile, updatedAt: `v${server.version}` });
  if (init.method === "PUT") {
    server.puts++;
    if (server.failPut.has(server.puts)) return answer({ error: "busy" }, 503);
    const body = JSON.parse(String(init.body));
    if (body.baseUpdatedAt !== `v${server.version}`) return answer({ profile: server.profile, updatedAt: `v${server.version}` }, 409);
    server.profile = body.profile;
    server.version++;
    return answer({ updatedAt: `v${server.version}` });
  }
  return answer({});
});

const { forgetLastKnownProfile, loadProfileForUser, saveProfileForUser } = await import("@/lib/storage");

const base = (): PreferenceProfile => ({ weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: null, hasCrashPad: null, seniorityNumber: null, cityPreferences: {}, completedAt: "2026-11-01T00:00:00.000Z", implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [], brainInterview: { exchanges: [], choices: [], pins: {} } });

/** Another device saves first. */
function otherDeviceSaves(profile: PreferenceProfile) {
  server.profile = profile;
  server.version++;
}

beforeEach(() => {
  local.clear();
  forgetLastKnownProfile();
  Object.assign(server, { profile: base(), version: 1, puts: 0, failPut: new Set() });
});

describe("a signed-in pilot's saves when another device saved first", () => {
  it("keeps both of two quick edits and the other device's change", async () => {
    await loadProfileForUser("p1");
    otherDeviceSaves({ ...base(), cityPreferences: { ANC: "love" } });
    const p1 = { ...base(), seniorityNumber: 4200 };
    const p2 = { ...p1, isCommuter: true };
    const [first, second] = await Promise.all([saveProfileForUser("p1", p1), saveProfileForUser("p1", p2)]);
    expect(server.profile).toMatchObject({ cityPreferences: { ANC: "love" }, seniorityNumber: 4200, isCommuter: true });
    expect(first.sync).toBe("merged");
    // The second was laid over the merged copy, so it's what the app shows.
    expect(second.sync).toBe("merged");
    expect(second.profile).toMatchObject({ cityPreferences: { ANC: "love" }, seniorityNumber: 4200, isCommuter: true });
  });

  it("hands back the merged copy when its own send fails, and a retry with it keeps the other device's interview", async () => {
    await loadProfileForUser("p1");
    const theirs = { ...base(), completedAt: "2026-11-10T00:00:00.000Z", discoveredFacts: ["from the other device"] } as unknown as PreferenceProfile;
    otherDeviceSaves(theirs);
    // The first PUT is refused (409); the merged copy's PUT fails.
    server.failPut = new Set([2]);
    const r = await saveProfileForUser("p1", { ...base(), seniorityNumber: 4200 });
    expect(r.sync).toBe("failed");
    expect(r.profile.completedAt).toBe("2026-11-10T00:00:00.000Z");
    // The app shows and retries with that copy (`showSavedCopy` in app-state).
    const retry = await saveProfileForUser("p1", r.profile);
    expect(retry.sync).toBe("saved");
    expect(server.profile?.completedAt).toBe("2026-11-10T00:00:00.000Z");
    expect(server.profile?.discoveredFacts).toEqual(["from the other device"]);
  });

  it("an edit made on the merged copy goes up as it is", async () => {
    await loadProfileForUser("p1");
    otherDeviceSaves({ ...base(), cityPreferences: { ANC: "love" } });
    const merged = (await saveProfileForUser("p1", { ...base(), seniorityNumber: 4200 })).profile;
    const next = await saveProfileForUser("p1", { ...merged, isCommuter: true });
    expect(next.sync).toBe("saved");
    expect(server.profile).toMatchObject({ cityPreferences: { ANC: "love" }, seniorityNumber: 4200, isCommuter: true });
  });
});
