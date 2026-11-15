import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "@/types/auth";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * A guest with a pack and an interview open in two tabs makes an account in one of them. The other tab hears of the
 * sign-in from the device's note of who's signed in (a storage event) and loads the account as a fresh load would. Heard
 * before the account holds the guest's work, it found an empty account and showed "upload your bid pack" in place of
 * the guest's lines. The provider's own functions, from one server render; storage and the network are stand-ins.
 */
const store = vi.hoisted(() => new Map<string, string>());
const done = vi.hoisted(() => [] as string[]);
/** What the account held on this device each time the note of who's signed in was written. */
const heldWhenNoted = vi.hoisted(() => [] as string[][]);
const HINT = "line-select:signed-in-hint:v1";
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === HINT && v === "1") heldWhenNoted.push([...done]);
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/" }));
vi.mock("@/lib/auth", () => ({ checkSession: async () => ({ user: null, reachable: true }), logout: async () => true }));
vi.mock("@/lib/bidpack-storage", () => ({
  clearBidPack: () => {},
  clearGuestUpload: () => {},
  dropPendingBidPackWrites: () => {},
  guestUploadedPackId: () => "pack-guest",
  loadBidPack: async () => null,
  markGuestUpload: () => {},
  saveBidPack: async (id: string | null) => {
    if (id) done.push("pack");
    return true;
  },
}));
vi.mock("@/lib/bidpack-server", () => ({ saveServerBidPack: async () => true, clearServerBidPack: async () => {} }));
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
  saveProfileForUser: async (id: string | null, profile: PreferenceProfile) => {
    if (id) done.push("profile");
    return { savedLocally: true, sync: "saved", profile };
  },
}));
vi.mock("@/lib/seniority-storage", () => ({ loadSeniority: () => null, saveSeniority: () => {} }));
vi.mock("@/lib/posthog-client", () => ({ captureUsageEvent: () => {}, identifyPilot: () => {}, resetPilotIdentity: () => {} }));
vi.mock("@/lib/device-data", () => ({ forgetPilotOnDevice: () => {}, forgetPilotWork: () => {} }));
vi.mock("@/lib/account-bid-pack", () => ({ accountBidPack: async () => ({ pack: null, saveFailed: false, noneOnAccount: true }) }));

const { AppStateProvider, useAppState } = await import("@/lib/app-state");
type AppState = ReturnType<typeof useAppState>;

const U: UserAccount = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "c@example.com", displayName: "J. Pilot", createdAt: "", plan: "free", emailVerified: true };
const guestPack = { id: "pack-guest", lines: [], bidPeriodStart: "2026-12-01" } as unknown as BidPack;
const guestProfile = { completedAt: "2026-11-01T00:00:00.000Z" } as unknown as PreferenceProfile;

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
  done.length = 0;
  heldWhenNoted.length = 0;
});

describe("a guest signing in while another tab of theirs is open", () => {
  it("tells the other tabs only once the account holds the guest's pack and profile", async () => {
    const app = provider();
    // What the guest had on screen; one server render has no state of its own to take it from.
    const signIn = app.handleAuthenticated as (user: UserAccount, opts: { stay: boolean; from: object }) => Promise<string>;
    await signIn(U, { stay: true, from: { user: null, bidPack: guestPack, profile: guestProfile, seniority: null } });
    expect(done).toEqual(["pack", "profile"]);
    expect(heldWhenNoted).toEqual([["pack", "profile"]]);
    expect(store.get(HINT)).toBe("1");
  });

  it("brings the guest's stars, tiers and own order on the pack into the account that takes it over", async () => {
    store.set("line-select:line-marks:guest:pack-guest:v1", '{"starred":["line-1001"],"hidden":[]}');
    store.set("line-select:line-tiers:guest:pack-guest:v1", "tiers");
    store.set("line-select:line-placements:guest:pack-guest:v1", "swaps");
    const app = provider();
    const signIn = app.handleAuthenticated as (user: UserAccount, opts: { stay: boolean; from: object }) => Promise<string>;
    await signIn(U, { stay: true, from: { user: null, bidPack: guestPack, profile: guestProfile, seniority: null } });
    // The account's list reads them under its own id: left under the guest's, it showed the pack with none of them.
    expect(store.get(`line-select:line-marks:${U.id}:pack-guest:v1`)).toBe('{"starred":["line-1001"],"hidden":[]}');
    expect(store.get(`line-select:line-tiers:${U.id}:pack-guest:v1`)).toBe("tiers");
    expect(store.get(`line-select:line-placements:${U.id}:pack-guest:v1`)).toBe("swaps");
  });
});
