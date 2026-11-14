import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

/**
 * A tab left open on pilot A while pilot B signs in in another tab of the same browser: the session cookie is B's now,
 * and tab A's next save went up with it. The real `getCurrentServerUser` and the real routes, with the database, the
 * cookie and the request's headers as stand-ins.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_HEADER = "x-line-select-account";

const req = vi.hoisted(() => ({ cookie: undefined as string | undefined, headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "line_select_session" && req.cookie ? { name, value: req.cookie } : undefined) }),
  headers: async () => req.headers,
}));

const db = vi.hoisted(() => ({
  packs: new Map<string, string>(),
  profiles: new Map<string, { profile: unknown; updatedAt: string }>(),
}));
vi.mock("@/lib/server/db", () => ({
  findSession: async (token: string) => (token === "b-session" ? { token, userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expiresAt: "2099-01-01T00:00:00.000Z" } : null),
  findUserById: async (id: string) => ({ id, email: `${id.slice(0, 1)}@example.com`, displayName: "Pilot", createdAt: "", plan: "free", emailVerified: true }),
  getBidPackRecord: async () => null,
  saveBidPackRecord: async (userId: string, packId: string) => void db.packs.set(userId, packId),
  deleteBidPackRecord: async (userId: string) => void db.packs.delete(userId),
  getPreferenceProfileRecord: async (userId: string) => db.profiles.get(userId) ?? null,
  savePreferenceProfile: async (userId: string, profile: unknown) => void db.profiles.set(userId, { profile, updatedAt: "2026-11-13T00:00:01.000Z" }),
  savePreferenceProfileOver: async (userId: string, profile: unknown, base: string | null) => {
    const current = db.profiles.get(userId) ?? null;
    if ((current?.updatedAt ?? null) !== base) return { saved: false, current };
    db.profiles.set(userId, { profile, updatedAt: "2026-11-13T00:00:01.000Z" });
    return { saved: true, updatedAt: "2026-11-13T00:00:01.000Z" };
  },
  deletePreferenceProfile: async (userId: string) => void db.profiles.delete(userId),
}));
vi.mock("@/lib/server/kv", () => ({ getJson: async () => null, setJson: async () => {}, incrementCounter: async () => 1 }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: async () => {} }));
vi.mock("@/lib/server/profile-history", () => ({ keepReplacedVersion: async () => {} }));
vi.mock("@/lib/server/pack-fingerprint", () => ({ tradePackFingerprint: () => "fingerprint" }));

const { getCurrentServerUser } = await import("@/lib/server/auth");
const bidPackRoute = await import("@/app/api/bid-pack/route");
const profileRoute = await import("@/app/api/preference-profile/route");

function profile(note: string): PreferenceProfile {
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
    interviewTranscript: [{ role: "user", content: note }],
  } as unknown as PreferenceProfile;
}

const packBytes = (id: string) => gzipSync(Buffer.from(JSON.stringify({ id, format: 2, lines: [], tripTable: {} })));

/** The tab says which account its screen is for, or nothing (a tab opened before it said so). */
function from(account: string | null) {
  req.headers = new Headers(account === null ? {} : { [ACCOUNT_HEADER]: account });
}

beforeEach(() => {
  req.cookie = "b-session";
  db.packs.clear();
  db.profiles.clear();
  db.profiles.set(B, { profile: profile("B's own"), updatedAt: "2026-11-13T00:00:00.000Z" });
});

describe("a tab still showing another account than the one signed in on this browser", () => {
  it("isn't taken for the account signed in now", async () => {
    from(A);
    expect(await getCurrentServerUser()).toBeNull();
    from(B);
    expect((await getCurrentServerUser())?.id).toBe(B);
    // A tab from before tabs said which account they're for is taken at its cookie, as before.
    from(null);
    expect((await getCurrentServerUser())?.id).toBe(B);
  });

  it("can't put its pack over the new account's", async () => {
    from(A);
    const res = await bidPackRoute.PUT(new Request("https://example.com/api/bid-pack", { method: "PUT", body: packBytes("pilot-a-pack") as BodyInit }));
    expect(res.status).toBe(401);
    expect(db.packs.size).toBe(0);
    db.packs.set(B, "pilot-b-pack");
    expect((await bidPackRoute.DELETE()).status).toBe(401);
    expect(db.packs.get(B)).toBe("pilot-b-pack");
  });

  it("can't save its profile into the new account, merged or not, nor read the new account's", async () => {
    from(A);
    const put = (baseUpdatedAt: string | null) =>
      profileRoute.PUT(new Request("https://example.com/api/preference-profile", { method: "PUT", body: JSON.stringify({ profile: profile("A's edit"), baseUpdatedAt }) }));
    // Refused outright, not answered with B's copy to merge with (that merged copy then went up as B's).
    const refused = await put("2026-11-12T00:00:00.000Z");
    expect(refused.status).toBe(401);
    expect(JSON.stringify(await refused.json())).not.toContain("B's own");
    expect((await put("2026-11-13T00:00:00.000Z")).status).toBe(401);
    expect((await profileRoute.GET()).status).toBe(401);
    expect((await profileRoute.DELETE()).status).toBe(401);
    expect(JSON.stringify(db.profiles.get(B)?.profile)).toContain("B's own");
  });

  it("a guest's tab isn't taken for the account signed in since in another tab", async () => {
    from("guest");
    expect(await getCurrentServerUser()).toBeNull();
    req.cookie = undefined;
    expect(await getCurrentServerUser()).toBeNull();
  });

  it("still saves for the account it shows", async () => {
    from(B);
    const res = await bidPackRoute.PUT(new Request("https://example.com/api/bid-pack", { method: "PUT", body: packBytes("pilot-b-pack") as BodyInit }));
    expect(res.status).toBe(200);
    expect(db.packs.get(B)).toBe("pilot-b-pack");
  });
});
