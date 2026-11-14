import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "@/types/auth";

/**
 * A tab left signed in as pilot A while pilot B signs in in another tab of the same browser: asked who's signed in
 * (on focus, on the other tab's word, or after the server refused one of its saves), the tab shows what a fresh load
 * would. The provider's own functions, taken from one server render; the device's storage and the network are
 * stand-ins, so nothing real is touched.
 */
const store = vi.hoisted(() => new Map<string, string>());
const net = vi.hoisted(() => ({ session: null as unknown, reachable: true }));
const spies = vi.hoisted(() => ({ loadedProfileFor: [] as (string | null)[], loadedPackFor: [] as string[], savedProfileFor: [] as (string | null)[], identified: [] as string[] }));
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
  checkSession: async () => ({ user: net.session, reachable: net.reachable }),
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
  loadProfileForUser: async (id: string | null) => {
    spies.loadedProfileFor.push(id);
    return null;
  },
  saveProfileForUser: async (id: string | null) => {
    spies.savedProfileFor.push(id);
    return { savedLocally: true, sync: "saved" };
  },
}));
vi.mock("@/lib/seniority-storage", () => ({ loadSeniority: () => null, saveSeniority: () => {} }));
vi.mock("@/lib/posthog-client", () => ({ captureUsageEvent: () => {}, identifyPilot: (id: string) => void spies.identified.push(id), resetPilotIdentity: () => {} }));
vi.mock("@/lib/device-data", () => ({ forgetPilotOnDevice: () => {}, forgetPilotWork: () => {} }));
vi.mock("@/lib/account-bid-pack", () => ({
  accountBidPack: async (id: string) => {
    spies.loadedPackFor.push(id);
    return { pack: null, saveFailed: false, noneOnAccount: false };
  },
}));

const { AppStateProvider, useAppState } = await import("@/lib/app-state");
const { shownAccount } = await import("@/lib/shown-account");
type AppState = ReturnType<typeof useAppState>;

const pilot = (id: string): UserAccount => ({ id, email: `${id.slice(0, 1)}@example.com`, displayName: "J. Pilot", createdAt: "", plan: "free", emailVerified: true });
const A = pilot("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const B = pilot("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
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

/** This tab signed in as A; then, in another tab, B signs in (the device's note of who's signed in says B now). */
async function tabLeftOnA(): Promise<AppState> {
  const app = provider();
  net.session = A;
  await app.handleAuthenticated(A, { stay: true });
  net.session = B;
  store.set(HINT, "1");
  store.set(LAST_USER, JSON.stringify(B));
  spies.loadedProfileFor.length = 0;
  spies.loadedPackFor.length = 0;
  spies.savedProfileFor.length = 0;
  return app;
}

beforeEach(() => {
  store.clear();
  net.session = null;
  net.reachable = true;
  spies.identified.length = 0;
});

describe("a tab left on another account", () => {
  it("shows the account signed in now, loaded as a fresh load would, and its calls go up for that account", async () => {
    const app = await tabLeftOnA();
    expect(shownAccount()).toBe(A.id);
    expect(await app.refreshUser()).toBe("confirmed");
    expect(shownAccount()).toBe(B.id);
    expect(spies.loadedProfileFor).toEqual([B.id]);
    expect(spies.loadedPackFor).toEqual([B.id]);
    // Nothing of A's is saved into B's account on the way (as signing in here would, taking over a guest's work).
    expect(spies.savedProfileFor).toEqual([]);
    expect(spies.identified.at(-1)).toBe(B.id);
  });

  it("shows the guest view when the other tab signed out", async () => {
    const app = await tabLeftOnA();
    net.session = null;
    expect(await app.refreshUser()).toBe("signed-out");
    expect(shownAccount()).toBeNull();
    expect(spies.loadedProfileFor).toEqual([null]);
  });

  it("without a signal, goes by the device's note of who signed in, as a load would", async () => {
    const app = await tabLeftOnA();
    net.reachable = false;
    expect(await app.refreshUser()).toBe("unknown");
    expect(shownAccount()).toBe(B.id);
    expect(spies.loadedProfileFor).toEqual([B.id]);
  });

  it("changes nothing when the account is still the one it shows", async () => {
    const app = await tabLeftOnA();
    net.session = A;
    store.set(LAST_USER, JSON.stringify(A));
    expect(await app.refreshUser()).toBe("confirmed");
    expect(shownAccount()).toBe(A.id);
    expect(spies.loadedProfileFor).toEqual([]);
  });
});
