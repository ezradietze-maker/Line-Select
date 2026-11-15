import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "@/types/auth";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * `refreshUser` (asked on focus, and by the confirm-email notice) racing a sign-out on the same tab. The provider's own
 * functions, taken from one server render; the device's storage and the network are stand-ins, so nothing real is
 * touched.
 */
const store = vi.hoisted(() => new Map<string, string>());
const net = vi.hoisted(() => ({ session: [] as ((user: unknown) => void)[] }));
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: () => null,
    length: 0,
  },
  addEventListener: () => {},
  removeEventListener: () => {},
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/" }));
vi.mock("@/lib/auth", () => ({
  // Held until the test answers it, as a slow answer from the server would be.
  checkSession: () => new Promise((resolve) => net.session.push((user) => resolve({ user, reachable: true }))),
  logout: async () => true,
}));
vi.mock("@/lib/bidpack-storage", () => ({
  clearBidPack: () => {},
  clearGuestUpload: () => {},
  dropPendingBidPackWrites: () => {},
  guestUploadedPackId: () => null,
  loadBidPack: async () => null,
  markGuestUpload: () => {},
  saveBidPack: async () => true,
}));
vi.mock("@/lib/storage", () => ({
  askToKeepStorage: () => {},
  clearProfile: () => {},
  clearProfileForUser: () => {},
  dropGuestRecords: () => {},
  dropPendingProfileWrites: () => {},
  forgetLastKnownProfile: () => {},
  GUEST_PROFILE_KEY: "guest",
  guestProfileChangedElsewhere: () => null,
  hasUnsyncedProfile: () => false,
  loadProfileForUser: async () => null,
  saveProfileForUser: async () => ({ savedLocally: true, sync: "saved" }),
}));
vi.mock("@/lib/seniority-storage", () => ({ loadSeniority: () => null, saveSeniority: () => {} }));
vi.mock("@/lib/posthog-client", () => ({ captureUsageEvent: () => {}, identifyPilot: () => {}, resetPilotIdentity: () => {} }));
vi.mock("@/lib/device-data", () => ({ forgetPilotOnDevice: () => {}, forgetPilotWork: () => {} }));
vi.mock("@/lib/account-bid-pack", () => ({ accountBidPack: async () => ({ pack: null, saveFailed: false, noneOnAccount: true }) }));

const { AppStateProvider, caughtUpState, standingChanged, useAppState } = await import("@/lib/app-state");
type AppState = ReturnType<typeof useAppState>;

const PILOT: UserAccount = { id: "11111111-1111-4111-8111-111111111111", email: "pilot@example.com", displayName: "J. Pilot", createdAt: "", plan: "free", emailVerified: false };
const HINT = "line-select:signed-in-hint:v1";
const LAST_USER = "line-select:last-user:v1";

function provider(): AppState {
  let app: AppState | null = null;
  function Grab() {
    app = useAppState();
    return null;
  }
  renderToString(
    <AppStateProvider>
      <Grab />
    </AppStateProvider>
  );
  return app!;
}

beforeEach(() => {
  store.clear();
  net.session.length = 0;
});

describe("refreshUser", () => {
  it("an answer that left before this tab signed out doesn't sign the device back in to the pilot who left", async () => {
    const app = provider();
    store.set(HINT, "1");
    store.set(LAST_USER, JSON.stringify(PILOT));
    // The tab is looked at again (a check goes out), and the pilot signs out before it comes back.
    const asked = app.refreshUser();
    await app.handleLogout();
    expect(store.get(HINT)).toBe("0");
    net.session.shift()!(PILOT);
    await asked;
    // The device was left as signed out: no hint, and no account for the next person here to be shown offline.
    expect(store.get(HINT)).toBe("0");
    expect(store.get(LAST_USER)).toBeUndefined();
  });

  it("still keeps the device's note of who's signed in when nothing changed meanwhile", async () => {
    const app = provider();
    const asked = app.refreshUser();
    net.session.shift()!({ ...PILOT, emailVerified: true });
    expect(await asked).toBe("confirmed");
    expect(store.get(HINT)).toBe("1");
    expect(JSON.parse(store.get(LAST_USER)!).id).toBe(PILOT.id);
  });
});

describe("standingChanged (whether refreshUser shows the server's account in place of the app's)", () => {
  const shown = { ...PILOT, emailVerified: true };
  it("is the server's answer when a free spot was just claimed, or Pro started or ended", () => {
    // Claiming a spot on Membership, then opening the ranking, still showed it locked until a reload.
    expect(standingChanged(shown, { ...shown, freeMemberAt: "2026-12-02T00:00:00.000Z" })).toBe(true);
    expect(standingChanged(shown, { ...shown, plan: "pro" })).toBe(true);
    expect(standingChanged({ ...shown, plan: "pro" }, shown)).toBe(true);
    expect(standingChanged(shown, { ...shown, emailVerified: false })).toBe(true);
  });

  it("leaves the app's account as it is when nothing it goes by changed", () => {
    expect(standingChanged(shown, { ...shown })).toBe(false);
    // An account from before these fields reads the same as one with them unset.
    expect(standingChanged({ ...shown, plan: undefined, freeMemberAt: undefined }, { ...shown, plan: "free", freeMemberAt: null })).toBe(false);
  });
});

describe("caughtUpState", () => {
  // The load gave up on a crawling connection and showed this device's copies; the server has answered since.
  const pack = (id: string) => ({ id }) as unknown as BidPack;
  const profile = (completedAt: string) => ({ completedAt }) as unknown as PreferenceProfile;
  const oct = pack("OCT26");
  const kept = profile("device");
  const shown = { ready: true, profile: kept, user: { ...PILOT, emailVerified: true }, bidPack: oct, parseResult: null, pendingProfile: null, seniority: null, freshBidPack: false, bidPackSaveFailed: false, profileSaveFailed: false };
  const was = { userId: PILOT.id, bidPack: oct, profile: kept };

  it("shows the month uploaded on another device, and the account's profile, in place of the device's copies", () => {
    const nov = pack("NOV26");
    const next = caughtUpState(shown, was, { bidPack: nov, profile: profile("account"), pendingFor: () => null });
    expect(next.bidPack).toBe(nov);
    expect(next.profile?.completedAt).toBe("account");
  });

  it("keeps a pack the pilot loaded and an edit they made since", () => {
    const uploaded = pack("NOV26-mine");
    const edited = profile("edited");
    const next = caughtUpState({ ...shown, bidPack: uploaded, profile: edited }, was, { bidPack: pack("NOV26"), profile: profile("account"), pendingFor: () => null });
    expect(next.bidPack).toBe(uploaded);
    expect(next.profile).toBe(edited);
  });

  it("changes nothing for another account, or when the account had nothing to give", () => {
    const other = { ...shown, user: null };
    expect(caughtUpState(other, was, { bidPack: pack("NOV26"), profile: profile("account"), pendingFor: () => null })).toBe(other);
    expect(caughtUpState(shown, was, { bidPack: null, profile: null, pendingFor: () => null })).toBe(shown);
  });
});
