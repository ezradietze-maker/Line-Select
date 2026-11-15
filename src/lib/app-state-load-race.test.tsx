import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "@/types/auth";
import type { BidPack } from "@/types/bidpack";

/**
 * The load's own session check (the provider's first effect), answered after something else on the tab already moved
 * on: a guest who signed in while it was on its way, or the account's pack read once the connection came back. The
 * provider runs its effects for real here, on a stand-in for the page (it draws nothing of its own), with stand-ins for
 * the device's storage and the network, so nothing real is touched.
 */
const store = vi.hoisted(() => new Map<string, string>());
const net = vi.hoisted(() => ({
  /** Session checks, each held until the test answers it, as a slow server would. */
  session: [] as ((answer: { user: unknown; reachable: boolean }) => void)[],
  offline: false,
  offlineListeners: new Set<() => void>(),
  accountPack: null as unknown,
  packAsked: [] as { userId: string; offline: boolean }[],
  /** The account's pack, held until the test lets it through, when set. */
  holdPack: null as null | (() => void)[],
  logoutOk: true,
}));
const doc = vi.hoisted(() => ({ nodeType: 9, visibilityState: "visible", activeElement: null, body: {}, addEventListener() {}, removeEventListener() {}, createElement: () => ({ setAttribute() {}, style: {} }) }));
vi.stubGlobal("window", {
  document: doc,
  HTMLIFrameElement: class {},
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
});
vi.stubGlobal("document", doc);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/" }));
vi.mock("@/lib/auth", () => ({
  checkSession: () => new Promise((resolve) => net.session.push(resolve)),
  logout: async () => net.logoutOk,
}));
vi.mock("@/lib/connection", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (l: () => void) => {
    net.offlineListeners.add(l);
    return () => void net.offlineListeners.delete(l);
  };
  return { isOffline: () => net.offline, useOffline: () => useSyncExternalStore(subscribe, () => net.offline, () => false) };
});
vi.mock("@/lib/bidpack-storage", () => ({
  clearBidPack: () => {},
  clearGuestUpload: () => {},
  dropPendingBidPackWrites: () => {},
  guestUploadedPackId: () => null,
  loadBidPack: async () => null,
  markGuestUpload: () => {},
  saveBidPack: async () => true,
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
  saveProfile: () => true,
  saveProfileForUser: async (_id: string | null, profile: unknown) => ({ savedLocally: true, sync: "saved", profile }),
}));
vi.mock("@/lib/seniority-storage", () => ({ loadSeniority: () => null, saveSeniority: () => {} }));
vi.mock("@/lib/posthog-client", () => ({ captureUsageEvent: () => {}, identifyPilot: () => {}, resetPilotIdentity: () => {} }));
vi.mock("@/lib/device-data", () => ({ forgetPilotOnDevice: () => {}, forgetPilotWork: () => {} }));
vi.mock("@/lib/trade-client", () => ({ fetchTradeOffers: async () => null, tripToSnapshot: () => null }));
vi.mock("@/lib/trades/holding-client", () => ({ fetchWaitingSuggestions: async () => null }));
vi.mock("@/lib/account-bid-pack", () => ({
  accountBidPack: async (userId: string, offline = false) => {
    net.packAsked.push({ userId, offline });
    const held = net.holdPack;
    if (!offline && held) await new Promise<void>((resolve) => held.push(resolve));
    return { pack: offline ? OCT : net.accountPack, saveFailed: false, noneOnAccount: !net.accountPack };
  },
}));

const { createRoot } = await import("react-dom/client");
const { AppStateProvider, useAppState } = await import("@/lib/app-state");
const { shownAccount, setShownAccount } = await import("@/lib/shown-account");
type AppState = ReturnType<typeof useAppState>;

const U: UserAccount = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", email: "d@example.com", displayName: "J. Pilot", createdAt: "", plan: "free", emailVerified: true };
const HINT = "line-select:signed-in-hint:v1";
const LAST_USER = "line-select:last-user:v1";
const pack = (id: string) => ({ id, lines: [], base: "MEM", aircraft: "B777", seat: "CA", month: "2026-12" }) as unknown as BidPack;
const OCT = pack("OCT26");
const NOV = pack("NOV26");

/** The provider mounted with its effects running; `app()` is what a screen reads from it now. */
async function mount(): Promise<() => AppState> {
  let app: AppState | null = null;
  function Grab() {
    app = useAppState();
    return null;
  }
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, addEventListener() {}, removeEventListener() {} };
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      <AppStateProvider>
        <Grab />
      </AppStateProvider>
    );
  });
  return () => app!;
}

/** Lets every answer already given work its way through the provider, effects included. */
const settle = () => act(async () => {});

beforeEach(() => {
  store.clear();
  net.session.length = 0;
  net.offline = false;
  net.accountPack = null;
  net.packAsked.length = 0;
  net.holdPack = null;
  net.logoutOk = true;
  setShownAccount(undefined as unknown as null);
});

describe("the load's session check, answered late", () => {
  it("doesn't undo a sign-in made while it was on its way", async () => {
    // A guest's device: the guest view shows straight away, before the check answers.
    const app = await mount();
    expect(app().ready).toBe(true);
    expect(net.session).toHaveLength(1);
    // They sign in before it answers; it was sent with no session, so it answers "nobody".
    await act(async () => {
      await app().handleAuthenticated(U, { stay: true });
    });
    expect(shownAccount()).toBe(U.id);
    net.session.shift()!({ user: null, reachable: true });
    await settle();
    // Still their account: every call from this tab says so, and the device still notes them as signed in.
    expect(shownAccount()).toBe(U.id);
    expect(app().user?.id).toBe(U.id);
    expect(store.get(HINT)).toBe("1");
    expect(JSON.parse(store.get(LAST_USER)!).id).toBe(U.id);
  });

  it("doesn't put this device's copies over a sign-in made while it went unanswered", async () => {
    const app = await mount();
    net.accountPack = NOV;
    await act(async () => {
      await app().handleAuthenticated(U, { stay: true });
    });
    expect(app().bidPack?.id).toBe("NOV26");
    net.packAsked.length = 0;
    // No answer in time: the load carries on as the account last signed in here, which is now the one just signed in,
    // and showed this device's older copy over the account's pack the sign-in brought in.
    net.offline = true;
    net.session.shift()!({ user: null, reachable: false });
    await settle();
    expect(net.packAsked).toEqual([]);
    expect(app().bidPack?.id).toBe("NOV26");
  });
});

describe("catching up once the connection is back", () => {
  /** A signed-in device whose load heard nothing in time: it shows this device's copy of the pack. */
  async function offlineLoad() {
    store.set(HINT, "1");
    store.set(LAST_USER, JSON.stringify(U));
    const app = await mount();
    net.offline = true;
    net.session.shift()!({ user: null, reachable: false });
    await settle();
    expect(app().bidPack?.id).toBe("OCT26");
    return app;
  }
  const backOnline = () =>
    act(async () => {
      net.offline = false;
      for (const l of [...net.offlineListeners]) l();
    });

  it("shows the account's newer pack after a sign-out that didn't get through", async () => {
    const app = await offlineLoad();
    net.accountPack = NOV;
    net.holdPack = [];
    await backOnline();
    net.session.shift()!({ user: U, reachable: true });
    await settle();
    // The account's pack is on its way when the pilot taps Sign out, and the connection drops again.
    expect(net.holdPack).toHaveLength(1);
    net.logoutOk = false;
    await act(async () => {
      await app().handleLogout();
    });
    expect(app().user?.id).toBe(U.id);
    // Still signed in, so the pack that comes back is still theirs to show.
    net.holdPack.shift()!();
    await settle();
    expect(app().bidPack?.id).toBe("NOV26");
  });
});
