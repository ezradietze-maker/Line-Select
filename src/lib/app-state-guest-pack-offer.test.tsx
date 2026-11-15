import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccount } from "@/types/auth";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * A guest loads this month's pack and does the interview on it, then signs in to an account that still holds last
 * month's. The provider runs its effects for real here, on a stand-in for the page, with stand-ins for the device's
 * storage and the network, so nothing real is touched.
 */
const store = vi.hoisted(() => new Map<string, string>());
const net = vi.hoisted(() => ({
  session: [] as ((answer: { user: unknown; reachable: boolean }) => void)[],
  guestPack: null as unknown,
  guestUpload: null as string | null,
  guestProfile: null as unknown,
  accountPack: null as unknown,
  accountProfile: null as unknown,
  serverPut: [] as string[],
  savedProfileFor: [] as (string | null)[],
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
  logout: async () => true,
}));
vi.mock("@/lib/connection", () => ({ isOffline: () => false, useOffline: () => false }));
vi.mock("@/lib/bidpack-storage", () => ({
  clearBidPack: () => {},
  clearGuestUpload: () => {},
  dropPendingBidPackWrites: () => {},
  guestUploadedPackId: () => net.guestUpload,
  loadBidPack: async (id: string | null) => (id === null ? net.guestPack : null),
  markGuestUpload: () => {},
  saveBidPack: async () => true,
}));
vi.mock("@/lib/bidpack-server", () => ({
  saveServerBidPack: async (pack: { id: string }) => {
    net.serverPut.push(pack.id);
    return true;
  },
  clearServerBidPack: async () => {},
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
  loadProfileForUser: async (id: string | null) => (id === null ? net.guestProfile : net.accountProfile),
  saveProfile: () => true,
  saveProfileForUser: async (id: string | null, profile: unknown) => {
    net.savedProfileFor.push(id);
    return { savedLocally: true, sync: "saved", profile };
  },
}));
vi.mock("@/lib/seniority-storage", () => ({ loadSeniority: () => null, saveSeniority: () => {} }));
vi.mock("@/lib/posthog-client", () => ({ captureUsageEvent: () => {}, identifyPilot: () => {}, resetPilotIdentity: () => {} }));
vi.mock("@/lib/device-data", () => ({ forgetPilotOnDevice: () => {}, forgetPilotWork: () => {} }));
vi.mock("@/lib/trade-client", () => ({ fetchTradeOffers: async () => null, tripToSnapshot: () => null }));
vi.mock("@/lib/trades/holding-client", () => ({ fetchWaitingSuggestions: async () => null }));
vi.mock("@/lib/account-bid-pack", () => ({
  accountBidPack: async () => ({ pack: net.accountPack, saveFailed: false, noneOnAccount: !net.accountPack }),
}));

const { createRoot } = await import("react-dom/client");
const { AppStateProvider, profileWithGuestPack, useAppState } = await import("@/lib/app-state");
const { setShownAccount } = await import("@/lib/shown-account");
type AppState = ReturnType<typeof useAppState>;

const U: UserAccount = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", email: "e@example.com", displayName: "J. Pilot", createdAt: "", plan: "free", emailVerified: true };
const pack = (month: string) => ({ id: `uploaded-mem-b777-ca-${month.toLowerCase()}`, lines: [], base: "MEM", aircraft: "B777", seat: "CA", month }) as unknown as BidPack;
const NOV = pack("NOV26");
const DEC = pack("DEC26");
const profile = (packId: string, completedAt: string, logbook: string[] = []) =>
  ({ completedAt, brainInterview: { packId, exchanges: [], choices: [] }, logbook: logbook.map((id) => ({ id })), cityPreferences: {} }) as unknown as PreferenceProfile;

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
  net.session.shift()?.({ user: null, reachable: true });
  await act(async () => {});
  return () => app!;
}

/** The guest's December pack and interview on it; the account's November pack and an older interview. */
async function guestSignsIn(): Promise<() => AppState> {
  net.guestPack = DEC;
  net.guestUpload = DEC.id;
  net.guestProfile = profile(DEC.id, "2026-11-14T00:00:00Z");
  net.accountPack = NOV;
  net.accountProfile = profile(NOV.id, "2026-10-14T00:00:00Z", ["OCT26"]);
  const app = await mount();
  expect(app().bidPack?.id).toBe(DEC.id);
  await act(async () => {
    await app().handleAuthenticated(U, { stay: true });
  });
  return app;
}

beforeEach(() => {
  store.clear();
  net.session.length = 0;
  net.guestPack = net.guestUpload = net.guestProfile = net.accountPack = net.accountProfile = null;
  net.serverPut.length = 0;
  net.savedProfileFor.length = 0;
  setShownAccount(undefined as unknown as null);
});

describe("signing in to an account that holds another pack than the guest just loaded", () => {
  it("shows the account's, and asks about the one just loaded rather than dropping it unseen", async () => {
    const app = await guestSignsIn();
    expect(app().bidPack?.id).toBe(NOV.id);
    expect(app().guestPackOffer?.id).toBe(DEC.id);
    expect(net.serverPut).toEqual([]);
  });

  it("takes the guest's pack and the interview done on it, keeping the account's logbook, when asked to", async () => {
    const app = await guestSignsIn();
    await act(async () => {
      app().handleTakeGuestPack();
    });
    await act(async () => {});
    expect(app().bidPack?.id).toBe(DEC.id);
    expect(app().profile?.brainInterview?.packId).toBe(DEC.id);
    expect(app().profile?.logbook?.map((e) => e.id)).toEqual(["OCT26"]);
    expect(app().guestPackOffer).toBeNull();
    expect(net.serverPut).toEqual([DEC.id]);
    expect(net.savedProfileFor).toContain(U.id);
  });

  it("keeps the account's as it is when they say so", async () => {
    const app = await guestSignsIn();
    await act(async () => {
      app().handleKeepAccountPack();
    });
    expect(app().bidPack?.id).toBe(NOV.id);
    expect(app().guestPackOffer).toBeNull();
    expect(net.serverPut).toEqual([]);
  });

  it("asks nothing when the account holds that same pack, or the guest's is the sample", async () => {
    net.guestPack = DEC;
    net.guestUpload = DEC.id;
    net.accountPack = DEC;
    let app = await mount();
    await act(async () => {
      await app().handleAuthenticated(U, { stay: true });
    });
    expect(app().guestPackOffer).toBeNull();

    net.guestPack = { ...DEC, id: "sample-bidpack" };
    net.guestUpload = null;
    net.accountPack = NOV;
    app = await mount();
    await act(async () => {
      await app().handleAuthenticated(U, { stay: true });
    });
    expect(app().guestPackOffer).toBeNull();
  });
});

describe("the profile that goes with the guest's pack", () => {
  it("is the guest's interview only when it was done on that pack after the account's", () => {
    const account = profile(NOV.id, "2026-10-14T00:00:00Z");
    expect(profileWithGuestPack(DEC, profile(DEC.id, "2026-11-14T00:00:00Z"), account)?.brainInterview?.packId).toBe(DEC.id);
    // Done on another pack (the sample, say), or before the account's: the account's stands.
    expect(profileWithGuestPack(DEC, profile("sample-bidpack", "2026-11-14T00:00:00Z"), account)).toBe(account);
    expect(profileWithGuestPack(DEC, profile(DEC.id, "2026-09-01T00:00:00Z"), account)).toBe(account);
    expect(profileWithGuestPack(DEC, null, account)).toBe(account);
  });
});
