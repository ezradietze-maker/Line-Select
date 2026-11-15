"use client";

import { markLanding } from "@/components/results/WheelsDown";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkSession, logout as logoutAccount } from "@/lib/auth";
import { isOffline, useOffline } from "@/lib/connection";
import { accountBidPack } from "@/lib/account-bid-pack";
import { clearServerBidPack, saveServerBidPack } from "@/lib/bidpack-server";
import { clearBidPack, clearGuestUpload, dropPendingBidPackWrites, guestUploadedPackId, loadBidPack, markGuestUpload, saveBidPack } from "@/lib/bidpack-storage";
import { withGuestRecords } from "@/lib/profile-merge";
import { generateFakeOffer, isSamplePack } from "@/lib/fake-trade-offers";
import { clearTradeHolding, fetchWaitingSuggestions } from "@/lib/trades/holding-client";
import { tradeDeadlineAt } from "@/lib/trades/offer-trips";
import { computeInboxSections, inboxNoticeKey, sameBidPack, unseenCount } from "@/lib/inbox";
import { correctionEvents, isLearnablePack } from "@/lib/learning/corrections";
import { postCorrections } from "@/lib/learning/learning-client";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import { captureUsageEvent, identifyPilot, resetPilotIdentity } from "@/lib/posthog-client";
import { clearPendingProfile, loadPendingProfile, pendingAfterLoading, savePendingProfile } from "@/lib/pending-profile-storage";
import { applyManualEdits, type ProfileEdits } from "@/lib/profile-edits";
import { loadSeniority, saveSeniority } from "@/lib/seniority-storage";
import { askToKeepStorage, clearProfile, clearProfileForUser, dropGuestRecords, dropPendingProfileWrites, forgetLastKnownProfile, GUEST_PROFILE_KEY, guestProfileChangedElsewhere, hasUnsyncedProfile, loadProfileForUser, saveProfile, saveProfileForUser } from "@/lib/storage";
import { fetchTradeOffers, tripToSnapshot } from "@/lib/trade-client";
import { loadSeenOfferIds, newArrivals, onSeenElsewhere, saveSeenOfferIds, type ToastBaseline } from "@/lib/trade-seen-storage";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";
import type { TradeOffer } from "@/types/trade";
import type { ToastItem } from "@/components/ui/Toast";
import { forgetPilotOnDevice, forgetPilotWork } from "@/lib/device-data";
import { clearServerDraft } from "@/lib/interview-draft-sync";
import { adoptGuestDrafts } from "@/lib/interview-draft";
import { landingAfterSignIn, landingPathFor } from "@/lib/landing-path";
import { monthOrdinal } from "@/lib/learning/hold-history";
import { isPackId, moveGuestWorkToAccount } from "@/lib/pack-id";
import { LOCAL_SAVE_FAILED_EVENT } from "@/lib/local-save-failed";
import { feedOffOwed, oweFeedOff } from "@/lib/calendar-feed-owed";
import { announceStartOver, caughtUpWithStartOver, onStartOverElsewhere } from "@/lib/start-over-signal";
import { onAccountRefused, onSignedInElsewhere, setShownAccount, shownAccount } from "@/lib/shown-account";

/**
 * Whether this device was signed in when the app last checked — not a credential (the session cookie is), just a
 * hint for whether a fresh load can show the guest's own data before the session check answers.
 */
const SIGNED_IN_HINT_KEY = "line-select:signed-in-hint:v1";

function readSignedInHint(): boolean {
  try {
    const hint = window.localStorage.getItem(SIGNED_IN_HINT_KEY);
    if (hint !== null) return hint === "1";
    // No hint yet (first load since it existed): a device holding an account's own saved pack or profile may well
    // still be signed in, so it waits for the session check rather than briefly showing — and routing on — guest data.
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) ?? "";
      if (/^line-select:(bidpack|preference-profile):/.test(key) && !key.includes(":guest:")) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function writeSignedInHint(user: UserAccount | null): void {
  try {
    window.localStorage.setItem(SIGNED_IN_HINT_KEY, user ? "1" : "0");
    if (user) window.localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // private mode — every load just waits on the session check, as before
  }
}

/** The account this device was last signed in to — stood in for when the session check can't reach the server. */
const LAST_USER_KEY = "line-select:last-user:v1";

/**
 * Written by the confirm page the moment its link signs this device in, and cleared once the guest's pack and profile
 * have joined the account (`handleAuthenticated`). Found still there when the app loads (the tab was reloaded or
 * closed in between), the load finishes that step itself rather than leaving the guest's work behind.
 */
export const CONFIRM_SIGN_IN_KEY = "line-select:confirm-sign-in:v1";
/** Written by the confirm page when an address is confirmed: other tabs hear of it (a storage event) and ask again who's signed in. */
export const EMAIL_CONFIRMED_KEY = "line-select:email-confirmed:v1";

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** What a guest had on this device, for an account signing in to take over (`handleAuthenticated`). */
type GuestWork = Pick<DataState, "user" | "bidPack" | "profile" | "seniority">;

function readLastUser(): UserAccount | null {
  try {
    const raw = window.localStorage.getItem(LAST_USER_KEY);
    const user = raw ? (JSON.parse(raw) as UserAccount) : null;
    return user && typeof user.id === "string" ? user : null;
  } catch {
    return null;
  }
}

/**
 * Who this device was last signed in to, as the tab that signed in or out wrote it down: null for nobody, undefined
 * when it can't tell (storage blocked, or nothing written yet). Another tab's sign-in shows up here first.
 */
function signedInHere(): string | null | undefined {
  const hint = readKey(SIGNED_IN_HINT_KEY);
  if (hint === "0") return null;
  return hint === "1" ? (readLastUser()?.id ?? undefined) : undefined;
}

/**
 * A signed-in pilot's save that came back as a different copy (merged with another device's): that copy is shown, and
 * it's what the retries send. Only while the profile on screen is still the one that was saved — an edit made since
 * goes up after it, laid over the merged copy (`saveProfileForUser`), and replacing it here would lose it.
 */
function showSavedCopy(
  sent: PreferenceProfile,
  saved: PreferenceProfile,
  userId: string | null,
  latest: { current: PreferenceProfile | null },
  setState: (update: (s: DataState) => DataState) => void
): void {
  if (saved === sent) return;
  if (latest.current === sent) latest.current = saved;
  setState((s) => (s.profile === sent && (s.user?.id ?? null) === userId ? { ...s, profile: saved } : s));
}

interface DataState {
  ready: boolean;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  bidPack: BidPack | null;
  parseResult: ParseBidPackResult | null;
  /** The just-finished interview's profile, awaiting confirmation before it's saved. */
  pendingProfile: PreferenceProfile | null;
  seniority: SeniorityInput | null;
  /** True from the moment a new bid pack is confirmed until the pilot either looks at rankings or starts the interview — drives the "same as last month?" prompt on Preferences, so a returning pilot isn't left with only "Retake the interview". */
  freshBidPack: boolean;
  /** True when the browser refused to keep the bid pack (storage full or blocked) — the pack works this session but won't survive a refresh. */
  bidPackSaveFailed: boolean;
  /** True when the browser refused to keep a GUEST's profile locally — the one case a local save failure means real data loss, since a signed-in pilot's profile also lives on the server. */
  profileSaveFailed: boolean;
}

/** Before the device and the account have been read: pilot screens wait, as on a fresh load. */
const NOT_LOADED: DataState = {
  ready: false,
  profile: null,
  user: null,
  bidPack: null,
  parseResult: null,
  pendingProfile: null,
  seniority: null,
  freshBidPack: false,
  bidPackSaveFailed: false,
  profileSaveFailed: false,
};

/**
 * What a fresh load shows for this account (or a guest): its pack, profile and seniority, from the device and the
 * account. `offline`: the server didn't answer who's signed in, so only what this device kept — asking it for the pack
 * and profile as well left a crawling connection's screens on "Loading…" for as long as those went unanswered too.
 */
async function loadStateFor(currentUser: UserAccount | null, offline = false): Promise<DataState> {
  const { pack: savedBidPack, saveFailed } = currentUser ? await accountBidPack(currentUser.id, offline) : { pack: await loadBidPack(null), saveFailed: false };
  return {
    ready: true,
    profile: await loadProfileForUser(currentUser?.id ?? null, offline),
    user: currentUser,
    bidPack: savedBidPack,
    parseResult: null,
    // A finished-but-unconfirmed interview survives a refresh on the confirmation screen.
    pendingProfile: loadPendingProfile(currentUser?.id ?? null, savedBidPack?.id ?? null),
    seniority: loadSeniority(currentUser?.id ?? null),
    freshBidPack: false,
    bidPackSaveFailed: saveFailed,
    profileSaveFailed: false,
  };
}

/** A signed-in load made from this device's copies alone (`loadStateFor` offline): whose, and what it showed. */
export interface OfflineLoad {
  userId: string;
  bidPack: BidPack | null;
  profile: PreferenceProfile | null;
}

/**
 * Whether the server's answer for the signed-in pilot changes what the app lets them do: a confirmed address, or a
 * membership (a free spot just claimed, Pro started or ended). Only the address was looked at, so a pilot who claimed a
 * free spot on Membership was still shown the ranking locked until they reloaded.
 */
export function standingChanged(shown: UserAccount, fresh: UserAccount): boolean {
  return shown.emailVerified !== fresh.emailVerified || (shown.plan ?? "free") !== (fresh.plan ?? "free") || (shown.freeMemberAt ?? null) !== (fresh.freeMemberAt ?? null);
}

/**
 * The account's pack and profile, read once the server answers after a load that had only this device's copies: each
 * one shown in place of the device's while the screen still shows that copy. One the pilot has changed since (a pack
 * uploaded, an edit) stays. Without this, a pack uploaded on the laptop stayed off the phone until it was reloaded, the
 * offline notice long gone. Null for anything the account couldn't give.
 */
export function caughtUpState(s: DataState, was: OfflineLoad, fresh: { bidPack: BidPack | null; profile: PreferenceProfile | null; pendingFor: (packId: string) => PreferenceProfile | null }): DataState {
  if (s.user?.id !== was.userId) return s;
  let next = s;
  if (fresh.bidPack && s.bidPack === was.bidPack && fresh.bidPack.id !== was.bidPack?.id) {
    next = { ...next, bidPack: fresh.bidPack, parseResult: null, pendingProfile: fresh.pendingFor(fresh.bidPack.id), freshBidPack: false };
  }
  if (fresh.profile && s.profile === was.profile) next = { ...next, profile: fresh.profile };
  return next;
}

/**
 * The pack a guest loaded on this device before signing in to an account that already holds another one: they're asked
 * which to go on with. Without asking, the account's (often last month's) came up, and the pack they'd just loaded, and
 * the interview done on it, were gone from view — then gone from the device at sign-out. Null when there's nothing to
 * ask: no account pack (the guest's is taken over), the same pack on both, the sample, a pack this guest didn't load, or
 * an older month's than the account's.
 */
export function guestPackToOffer(before: GuestWork, accountPack: BidPack | null, guestUpload: string | null): BidPack | null {
  const guestPack = before.bidPack;
  if (before.user || !guestPack || !accountPack || isSamplePack(guestPack) || guestPack.id !== guestUpload) return null;
  // Nor one for a month before the account's: left from a guest visit weeks ago, not just loaded, and taken, it went
  // over the account's newer one.
  const [guestMonth, accountMonth] = [monthOrdinal(guestPack.month), monthOrdinal(accountPack.month)];
  if (guestMonth !== null && accountMonth !== null && guestMonth < accountMonth) return null;
  return isPackId(accountPack.id, guestPack) ? null : guestPack;
}

/**
 * The profile to go on with once the account takes the guest's pack: the guest's interview, when it was done on that
 * pack after the account's last one, with the months the account logged and its checklist kept; else the account's.
 */
export function profileWithGuestPack(guestPack: BidPack, guest: PreferenceProfile | null, account: PreferenceProfile | null): PreferenceProfile | null {
  if (!guest) return account;
  const onThisPack = !!guest.brainInterview && isPackId(guest.brainInterview.packId, guestPack);
  if (account && !(onThisPack && (Date.parse(guest.completedAt) || 0) > (Date.parse(account.completedAt) || 0))) return account;
  return account ? withGuestRecords(guest, account) : guest;
}

interface AppStateValue extends DataState {
  interviewKey: number;
  demoOffer: TradeOffer | null;
  toasts: ToastItem[];
  inboxUnreadCount: number;
  /** The real offers as last polled (signed in, with a pack) — screens listing offers refresh when it changes. */
  tradeOffers: TradeOffer[];
  /** How the signed-in pilot's last profile save went: "merged" with a newer copy from another device, or "failed" (kept on this device, retried). */
  profileSync: "ok" | "merged" | "failed";
  /** True when the browser refused a tier move, star, swap or sort choice (`saveOrReport`): it works now, but not after a refresh. */
  listSaveFailed: boolean;
  handleDismissListSaveWarning: () => void;
  /** Asks for the offers and the waiting trades now, not at the next poll: after the pilot answers one, so the Inbox badge is right straight away. */
  refreshTradeActivity: () => void;
  handleDismissProfileSync: () => void;
  handleAcceptDemoOffer: () => void;
  handleParsed: (result: ParseBidPackResult) => void;
  handleTrySample: () => void;
  handleBidPackConfirmed: (newBidPack: BidPack) => void;
  handleUploadDifferent: () => void;
  handleInterviewComplete: (newProfile: PreferenceProfile) => void;
  handleConfirmPreferences: (weights: PreferenceWeights) => void;
  /** The story-driven interview reviews its own priorities before finishing, so its profile is saved as it comes. */
  handleBrainInterviewComplete: (profile: PreferenceProfile) => void;
  handleUpdateProfile: (updated: PreferenceProfile) => void;
  handleUpdateProfileWith: (update: (latest: PreferenceProfile) => PreferenceProfile) => void;
  handleSaveProfileEdits: (edits: ProfileEdits) => void;
  handleSaveSeniority: (input: SeniorityInput) => void;
  handleStartInterview: () => void;
  handleAcknowledgeFreshBidPack: () => void;
  handleStartOver: () => void;
  handleDismissBidPackSaveWarning: () => void;
  handleDismissProfileSaveWarning: () => void;
  handleDismissToast: (id: string) => void;
  handleToastClick: (id: string) => void;
  /**
   * After signing in: the guest's own work joins an account that has none, and the app moves on to where the pilot
   * belongs. With `stay`, it doesn't move, and the place it would have gone is returned instead.
   */
  handleAuthenticated: (newUser: UserAccount, opts?: { stay?: boolean }) => Promise<string>;
  /** Signed in to an account that holds another pack than the one loaded as a guest just before: that one, to ask about. */
  guestPackOffer: BidPack | null;
  handleTakeGuestPack: () => void;
  handleKeepAccountPack: () => void;
  /** Asks the server again who's signed in, for an account whose address or membership may have just changed. */
  refreshUser: () => Promise<"confirmed" | "waiting" | "signed-out" | "unknown">;
  handleContinueAsGuest: () => void;
  /** Signs out; `to`, where to go then (the sign-in form, to use another account) — otherwise wherever a guest belongs. */
  handleLogout: (opts?: { to?: string }) => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

/** The loaded bid pack, for a widget that works with or without one and may sit outside the app (a test page). */
export function useBidPackIfAny(): BidPack | null {
  return useContext(AppStateContext)?.bidPack ?? null;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<DataState>(NOT_LOADED);
  const { user, bidPack, pendingProfile } = state;
  const [interviewKey, setInterviewKey] = useState(0);
  const [demoOffer, setDemoOffer] = useState<TradeOffer | null>(null);
  const [waitingTrades, setWaitingTrades] = useState(0);
  const [realOffers, setRealOffers] = useState<TradeOffer[]>([]);
  /** Whose board, and which pack's, `realOffers` is: until the first poll for this pilot and pack, it isn't theirs. */
  const [realOffersKey, setRealOffersKey] = useState<string | null>(null);
  /** When the offers' trade deadlines were last judged (`offerStillTradeable`): at each poll that changed them, and as the next one passes. */
  const [deadlineNow, setDeadlineNow] = useState(0);
  /** The offers this pilot has looked at in the Inbox, kept on this device (`trade-seen-storage.ts`), and whose they are. */
  const [seen, setSeen] = useState<{ userId: string | null; ids: Set<string> }>({ userId: null, ids: new Set() });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  /** How the signed-in pilot's last profile save went (see `persistProfile`). */
  const [profileSync, setProfileSync] = useState<"ok" | "merged" | "failed">("ok");
  const [listSaveFailed, setListSaveFailed] = useState(false);
  /** The pack a guest loaded before signing in to an account holding another, and their profile then (`guestPackToOffer`). */
  const [guestOffer, setGuestOffer] = useState<{ userId: string; pack: BidPack; profile: PreferenceProfile | null } | null>(null);
  const showAccountNowRef = useRef<(now: UserAccount | null) => void>(() => {});
  /** Counts this tab's sign-ins and sign-outs, so an answer about who's signed in asked for before one isn't used after it (`refreshUser`). */
  const signInsRef = useRef(0);
  const adoptOnLoadRef = useRef<(user: UserAccount, from: GuestWork) => Promise<unknown>>(async () => {});
  /** The load that had only this device's copies, until the account has been read (`catchUpAfterOfflineLoad`). */
  const offlineLoadRef = useRef<OfflineLoad | null>(null);
  const catchUpRef = useRef<(was: OfflineLoad) => Promise<void>>(async () => {});
  const offlineNow = useOffline();
  const latestProfileRef = useRef<PreferenceProfile | null>(null);
  const realOffersRef = useRef<TradeOffer[]>([]);
  /** The trade poll below, for a screen to run straight after an answer (`refreshTradeActivity`). */
  const tradePollRef = useRef<(() => Promise<void>) | null>(null);
  const toastBaselineRef = useRef<ToastBaseline | null>(null);
  const pathname = usePathname();
  const onTradeBoard = pathname === "/trade-board";
  const onInbox = pathname === "/inbox";
  /** Which pack (and pilot) the current example offer was made for. */
  const demoOfferKey = useRef<string | null>(null);
  // The router's path, not the address bar's: during a navigation's render the address bar still shows the old page.
  const onInboxRef = useRef(false);

  useEffect(() => {
    // One-time read of external stores (server session + localStorage) to
    // resolve the initial profile/bidPack/user — can't happen during render
    // since it would mismatch the server-rendered "not ready yet" state.
    let cancelled = false;
    async function bootstrap() {
      // A device that wasn't signed in last time is almost certainly a guest now, and a guest's pack and profile are
      // all on this device — so show them straight away instead of waiting on the session check (which takes a second
      // or more when the server is cold). If the check then finds an account after all, its data replaces them.
      const assumedGuest = !readSignedInHint();
      if (assumedGuest) {
        const guest = await loadStateFor(null);
        if (!cancelled) setState(guest);
      }
      // Signed in (or out) on this tab while the check was on its way — a guest's view shows before it answers: the
      // answer is of the session before that, and acted on, it put the tab and the device's note back to that one.
      const asked = signInsRef.current;
      const session = await checkSession();
      if (cancelled || signInsRef.current !== asked) return;
      // No answer from the server (no signal): carry on as the account this device was last signed in to, rather than
      // dropping a signed-in pilot to an empty guest view until the connection comes back.
      const currentUser = session.reachable ? session.user : readLastUser();
      // From here on, every call to the server says it's for this account (`apiFetch`).
      setShownAccount(currentUser?.id ?? null);
      if (session.reachable) writeSignedInHint(currentUser);
      // This device's confirm link signed this account in, and the step that brings the guest's work across didn't
      // finish (the tab reloaded or closed first): it's finished here, from what the guest had.
      if (currentUser && readKey(CONFIRM_SIGN_IN_KEY) === currentUser.id) {
        await adoptOnLoadRef.current(currentUser, await loadStateFor(null));
        return;
      }
      // Signed in already: a guest pack still on the device was uploaded before this account signed in, not for it.
      if (currentUser) clearGuestUpload();
      if (currentUser) identifyPilot(currentUser.id);
      if (assumedGuest && !currentUser) return;
      // No answer at all (or none in time): only what this device kept. A server that answered with an error may still
      // give the pack and profile, as before.
      const offline = !session.reachable && isOffline();
      const resolved = await loadStateFor(currentUser, offline);
      if (cancelled || signInsRef.current !== asked) return;
      // Read from the account once the server answers again (`caughtUpState`).
      if (offline && currentUser) offlineLoadRef.current = { userId: currentUser.id, bidPack: resolved.bidPack, profile: resolved.profile };
      setState(resolved);
      // An edit kept on this device that the load couldn't send either (still no signal, the server busy): the notice
      // shows and the retries below run, as for a save that failed in this visit.
      if (currentUser && hasUnsyncedProfile(currentUser.id)) setProfileSync("failed");
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Sample pack only: rotates a synthetic Trade Board offer every 15-20s so a
    // first-time visitor can see how the board works. Never touches the server.
    // Cleared entirely with any other pack, or none.
    if (!bidPack || !isSamplePack(bidPack)) {
      demoOfferKey.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDemoOffer(null);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function rotate(again: boolean) {
      if (!bidPack) return;
      const myOpen = user
        ? realOffersRef.current.find((o) => o.offeringUserId === user.id && o.status === "open")
        : undefined;
      setDemoOffer(generateFakeOffer(bidPack, myOpen?.offeredTrip.pairingNumber ?? null));
      if (again) timeoutId = setTimeout(() => rotate(true), 15000 + Math.random() * 5000);
    }

    // It keeps rotating only while the Trade Board is open: every rotation re-renders everything that reads app
    // state, and on the rankings that was a whole list of cards redrawn every fifteen seconds for nothing on screen.
    // Arriving on the board keeps the offer already made for this pack (no swap mid-transition) and starts the clock.
    const packKey = `${bidPack.id}|${user?.id ?? ""}`;
    if (demoOfferKey.current !== packKey) {
      demoOfferKey.current = packKey;
      rotate(onTradeBoard);
    } else if (onTradeBoard) {
      timeoutId = setTimeout(() => rotate(true), 15000 + Math.random() * 5000);
    }
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidPack?.id, user?.id, onTradeBoard]);

  useEffect(() => {
    // Polls real trade offers (independent of the demo rotation above) so
    // the Inbox badge and toast notifications react to real pilot activity,
    // not just to screens that happen to be mounted.
    if (!user || !bidPack) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRealOffers([]);
      setRealOffersKey(null);
      setWaitingTrades(0);
      return;
    }
    let cancelled = false;
    let last = "";
    const key = `${user.id}|${bidPack.id}`;
    // Only this pack's seat and month: the server sends no other seat's offers.
    const board = { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, month: bidPack.month };
    async function poll() {
      // Not while the tab is in the background, and no state change when nothing changed — an unchanged poll used to
      // re-render the whole app every ten seconds.
      if (document.visibilityState === "hidden") return;
      if (bidPack && !isSamplePack(bidPack)) {
        const waiting = await fetchWaitingSuggestions(bidPack.id);
        if (!cancelled && waiting !== null) setWaitingTrades(waiting);
      }
      const data = await fetchTradeOffers(board);
      // A failed poll keeps what was last seen: an empty list would read as every offer withdrawn.
      if (!data) return;
      const signature = JSON.stringify(data);
      if (cancelled || signature === last) return;
      last = signature;
      setRealOffers(data);
      setRealOffersKey(key);
      setDeadlineNow(Date.now());
    }
    poll();
    tradePollRef.current = poll;
    const intervalId = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      if (tradePollRef.current === poll) tradePollRef.current = null;
      clearInterval(intervalId);
    };
  }, [user, bidPack]);

  useEffect(() => {
    realOffersRef.current = realOffers;
  }, [realOffers]);

  const viewerId = user?.id ?? null;
  const offersKey = user && bidPack ? `${user.id}|${bidPack.id}` : null;
  const offersLoaded = offersKey !== null && realOffersKey === offersKey;

  const notifiableOffers = useMemo(() => {
    // Not until this pilot's board for this pack is in: the last pilot's or pack's offers would count as theirs.
    if (!bidPack || !user || !offersLoaded) return [];
    const visible = realOffers.filter((o) => sameBidPack(o, bidPack));
    // Example offers never notify — a real pilot shouldn't get a toast or an
    // unread badge for a trade offer that doesn't exist.
    // Nor those past their trade deadline, which the Inbox and the board leave off too.
    const { needsResponse, directInterest } = computeInboxSections(visible, user.id, { pack: bidPack, now: deadlineNow });
    const byId = new Map<string, TradeOffer>();
    for (const offer of [...needsResponse, ...directInterest]) byId.set(offer.id, offer);
    return [...byId.values()];
  }, [realOffers, bidPack, user, offersLoaded, deadlineNow]);

  useEffect(() => {
    // Judged again as the next offer's deadline passes, not every minute: a change here redraws all that reads app state.
    if (!bidPack) return;
    const next = Math.min(
      ...realOffers.flatMap((o) =>
        [o.offeredTrip, o.responderTrip].map((t) => (t ? tradeDeadlineAt(bidPack, o.bidPackMeta, t) : null)).filter((at): at is number => at !== null && at > deadlineNow)
      )
    );
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setDeadlineNow(Date.now()), Math.min(Math.max(0, next - Date.now()) + 1000, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [realOffers, bidPack, deadlineNow]);

  const seenOfferIds = seen.userId === viewerId ? seen.ids : null;

  useEffect(() => {
    // The seen list belongs to the account: read from this device when the pilot changes (a guest has none).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen({ userId: viewerId, ids: viewerId ? loadSeenOfferIds(viewerId) : new Set() });
    if (!viewerId) return;
    // Opening the Inbox in another tab clears the badge in this one too.
    return onSeenElsewhere(viewerId, (kept) =>
      setSeen((prev) => (prev.userId !== viewerId || [...kept].every((id) => prev.ids.has(id)) ? prev : { userId: viewerId, ids: new Set([...prev.ids, ...kept]) }))
    );
  }, [viewerId]);

  useEffect(() => {
    if (seen.userId) saveSeenOfferIds(seen.userId, seen.ids);
  }, [seen]);

  // A suggested trade waiting on the pilot counts until they answer it: unlike an offer, opening the Inbox doesn't deal with it.
  // Nothing counts until this pilot's seen list has been read, or every offer would flash up as unread first.
  const inboxUnreadCount = (seenOfferIds ? unseenCount(notifiableOffers, seenOfferIds) : 0) + waitingTrades;

  useEffect(() => {
    // Only the Inbox counts as "checked" — the Trade Board shows the same
    // offers, but browsing it isn't the same deliberate act as opening your
    // notifications, so a Trade Board visit alone shouldn't clear the badge.
    onInboxRef.current = onInbox;
    if (!onInbox || !viewerId) return;
    if (notifiableOffers.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen((prev) => {
      if (prev.userId !== viewerId) return prev;
      let changed = false;
      const next = new Set(prev.ids);
      for (const offer of notifiableOffers) {
        const key = inboxNoticeKey(offer);
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? { userId: prev.userId, ids: next } : prev;
    });
  }, [notifiableOffers, onInbox, viewerId]);

  useEffect(() => {
    // Toasts only a brand-new arrival (never the pre-existing backlog found
    // on first load), and only while the pilot isn't already looking at the
    // Inbox itself — the Trade Board still gets toasts, since browsing it
    // no longer counts as having checked notifications (see above). The
    // backlog is whatever the first poll for this pilot and pack finds
    // (`newArrivals`), so nothing is compared before that poll is in.
    if (!offersLoaded || !offersKey) return;
    const { baseline, fresh } = newArrivals(toastBaselineRef.current, offersKey, notifiableOffers.map(inboxNoticeKey));
    toastBaselineRef.current = baseline;
    const newOnes = notifiableOffers.filter((o) => fresh.includes(inboxNoticeKey(o)));
    if (newOnes.length === 0 || onInboxRef.current) return;
    setToasts((prev) => [
      ...prev,
      ...newOnes.map((offer) => ({
        id: `${offer.id}-${Date.now()}`,
        title: "New trade request",
        body:
          offer.status === "pending"
            ? `${offer.responderDisplayName} proposed a trade for your ${
                offer.offeredTrip.pairingNumber ? `Pairing ${offer.offeredTrip.pairingNumber}` : "trip"
              }`
            : `${offer.offeringDisplayName} wants your Pairing ${offer.wantedPairingNumber}`,
      })),
    ]);
  }, [notifiableOffers, offersLoaded, offersKey]);

  useEffect(() => {
    latestProfileRef.current = state.profile;
  }, [state.profile]);

  // A save to the account that didn't get through is tried again when the connection comes back, and each minute.
  const userId = user?.id ?? null;
  /** Who's signed in now, for a save that comes back after they've signed out (`persistProfile`). */
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    // A guest's profile lives only on this device, so a month logged in another tab is shown in this one too, rather
    // than this tab's older copy being what the next edit here starts from.
    if (!state.ready || userId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== GUEST_PROFILE_KEY || e.newValue === null) return;
      const changed = guestProfileChangedElsewhere();
      if (changed) setState((s) => (s.user ? s : { ...s, profile: changed }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [state.ready, userId]);

  useEffect(() => {
    // Started over in another tab: what this one holds was deleted there, and left on screen, its next star, tier move
    // or tick put it all back, the profile on the account too. It goes here as well, along with any save still on its
    // way, and the tab shows what a fresh load would: no pack, no profile. Nothing kept is touched — loaded again from
    // the account straight away, the pack could come back before the other tab's delete reached it, and a tab woken
    // later could remove a new pack uploaded there since.
    if (!state.ready) return;
    return onStartOverElsewhere(userId, () => {
      dropPendingBidPackWrites(userId);
      dropPendingProfileWrites(userId);
      caughtUpWithStartOver();
      setInterviewKey((k) => k + 1);
      setProfileSync("ok");
      setListSaveFailed(false);
      setState((s) =>
        (s.user?.id ?? null) !== userId
          ? s
          : { ...s, profile: null, bidPack: null, parseResult: null, pendingProfile: null, seniority: null, freshBidPack: false, bidPackSaveFailed: false, profileSaveFailed: false }
      );
    });
  }, [state.ready, userId]);
  useEffect(() => {
    if (profileSync !== "failed" || !userId) return;
    const retry = async () => {
      const profile = latestProfileRef.current;
      if (!profile) return;
      // A save refused because the session ended (signed out in another tab, or expired) or is someone else's now
      // (signed in there) would fail forever behind a "will try again" notice: the server says who's signed in now,
      // and the tab shows that, as a fresh load would.
      const asked = signInsRef.current;
      const session = await checkSession();
      if (signInsRef.current !== asked) return;
      if (session.reachable && (session.user?.id ?? null) !== userId) {
        showAccountNowRef.current(session.user);
        return;
      }
      void saveProfileForUser(userId, profile).then((r) => {
        showSavedCopy(profile, r.profile, userId, latestProfileRef, setState);
        if (r.sync === "saved") setProfileSync("ok");
        else if (r.sync === "merged") setProfileSync("merged");
      });
    };
    const tryAgain = () => void retry();
    window.addEventListener("online", tryAgain);
    const timer = setInterval(tryAgain, 60_000);
    return () => {
      window.removeEventListener("online", tryAgain);
      clearInterval(timer);
    };
  }, [profileSync, userId]);

  useEffect(() => {
    // A Start over whose turning off the calendar link didn't get through (`calendar-feed-owed`): asked again on loading,
    // when the connection is back, and on coming back to the tab.
    if (!state.ready || !userId) return;
    const pay = () => {
      if (feedOffOwed() === userId) void import("@/lib/calendar-feed-client").then(({ payFeedOffOwed }) => payFeedOffOwed(userId)).catch(() => {});
    };
    const onVisible = () => document.visibilityState === "visible" && pay();
    pay();
    window.addEventListener("online", pay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", pay);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.ready, userId]);

  useEffect(() => {
    // The list's own saves (tiers, stars, swaps, the sort) are made by the screens that hold them; any one the browser
    // refuses is reported here, so the pilot hears it won't survive a refresh instead of finding it gone.
    const failed = () => setListSaveFailed(true);
    window.addEventListener(LOCAL_SAVE_FAILED_EVENT, failed);
    return () => window.removeEventListener(LOCAL_SAVE_FAILED_EVENT, failed);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 8000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  function handleAcceptDemoOffer() {
    if (!user || !bidPack) return;
    setDemoOffer((prev) => {
      if (!prev) return prev;
      const allTrips = bidPack.lines.flatMap((line) =>
        line.trips.map((trip) => ({ lineNumber: line.lineNumber, trip }))
      );
      const responder =
        allTrips.find((t) => t.trip.pairingNumber !== prev.offeredTrip.pairingNumber) ?? allTrips[0];
      if (!responder) return prev;
      const now = new Date().toISOString();
      return {
        ...prev,
        status: "accepted",
        responderUserId: user.id,
        responderDisplayName: user.displayName,
        responderTrip: tripToSnapshot(responder.trip, responder.lineNumber, bidPack.bidPeriodStart),
        respondedAt: now,
        resolvedAt: now,
      };
    });
  }

  function handleParsed(result: ParseBidPackResult) {
    setState((s) => ({ ...s, parseResult: result }));
    router.push("/preview");
  }

  function handleTrySample() {
    // Fetched when asked for, not shipped on every screen.
    void import("@/lib/sample-bidpack").then(({ SAMPLE_BID_PACK }) => handleBidPackConfirmed(SAMPLE_BID_PACK));
  }

  function handleBidPackConfirmed(newBidPack: BidPack) {
    askToKeepStorage();
    // Deliberately does NOT clear the existing profile: a new bid pack
    // almost always means a new bidding cycle for a pilot who's used this
    // app before, not a brand-new pilot. The old profile stays in state so
    // the next interview receives it as `priorProfile` and can actually
    // fold cross-cycle history (reaffirmed facts, contradictions) instead
    // of starting from zero every month — the entire point of that
    // machinery, which a blanket clear here used to defeat on every single
    // confirm. `handleStartOver` is the deliberate, explicit reset instead.
    // Compressing it takes a moment: the pack is on screen straight away, and the notice shows if the browser refuses it.
    void saveBidPack(user?.id ?? null, newBidPack).then((saved) => {
      if (!saved) setState((s) => (s.bidPack === newBidPack ? { ...s, bidPackSaveFailed: true } : s));
    });
    // A signed-in pilot's pack also goes to their account, so a new device or a cleared browser gets it back. A guest's
    // own upload is marked, so the account they sign in to next can take it over (see `handleAuthenticated`).
    if (user) void saveServerBidPack(newBidPack, user.id);
    else if (!isSamplePack(newBidPack)) markGuestUpload(newBidPack.id);
    // An interview finished on this same pack and not yet confirmed stays, and is where they go back to.
    const keptPending = pendingAfterLoading(pendingProfile, bidPack?.id ?? null, newBidPack.id);
    if (!keptPending) clearPendingProfile(user?.id ?? null);
    setState((s) => ({
      ...s,
      bidPackSaveFailed: false,
      bidPack: newBidPack,
      parseResult: null,
      pendingProfile: keptPending,
      freshBidPack: true,
    }));
    router.push(keptPending ? "/confirm-preferences" : "/preferences");
    captureUsageEvent("bid_pack_confirmed");
  }

  function handleUploadDifferent() {
    setState((s) => ({ ...s, parseResult: null }));
    // Straight to the file picker: the pack already loaded isn't the one they were trying to replace it with.
    router.push("/upload?replace");
  }

  function handleInterviewComplete(newProfile: PreferenceProfile) {
    // Not saved yet — the pilot reviews (and can still adjust) the
    // summarized weights on the confirmation screen before this counts.
    if (bidPack) savePendingProfile(user?.id ?? null, bidPack.id, newProfile);
    setState((s) => ({ ...s, pendingProfile: newProfile }));
    router.push("/confirm-preferences");
  }

  function handleConfirmPreferences(weights: PreferenceWeights) {
    if (!pendingProfile) return;
    // Goes through applyManualEdits (not a bare `{...profile, weights}`) so a
    // nudge on the confirmation screen is written back into the underlying
    // facts too — otherwise it would revert the next bid cycle.
    const confirmed = applyManualEdits(pendingProfile, { weights });
    reportCorrections(pendingProfile, confirmed);
    clearPendingProfile(user?.id ?? null);
    setState((s) => ({ ...s, profile: confirmed, pendingProfile: null }));
    markLanding();
    router.push("/results");
    captureUsageEvent("interview_completed");
    persistProfile(confirmed);
  }

  /**
   * Saves a profile on this device and, for a signed-in pilot, to their account — and says so when that didn't
   * work: a guest whose browser refused it (`profileSaveFailed`; local storage is their only copy), an account save
   * that couldn't get through (`profileSync` "failed", retried below), or one merged with a newer copy from another
   * device ("merged", and the merged profile is what's shown from then on).
   */
  function persistProfile(profile: PreferenceProfile) {
    const savedFor = user?.id ?? null;
    void saveProfileForUser(savedFor, profile).then((r) => {
      // Signed in or out while it was saving: it's no longer the profile on screen, and says nothing about the new one.
      if (userIdRef.current !== savedFor) return;
      const stillTheirs = (s: DataState) => (s.user?.id ?? null) === savedFor;
      if (!savedFor) {
        // Merged with what another tab saved since this one last read it: the merged copy is what's shown.
        const merged = r.profile !== profile;
        if (r.savedLocally && !merged) return;
        setState((s) => (!stillTheirs(s) ? s : { ...s, ...(r.savedLocally ? {} : { profileSaveFailed: true }), ...(merged && s.profile === profile ? { profile: r.profile } : {}) }));
        return;
      }
      // Merged — even when the merged copy's own send then failed, so the retries send it and not the copy from before
      // the merge, which would go up over the other device's change.
      showSavedCopy(profile, r.profile, savedFor, latestProfileRef, setState);
      if (r.sync === "merged") setProfileSync("merged");
      else if (r.sync === "failed") setProfileSync("failed");
      else if (r.sync === "saved") setProfileSync((p) => (p === "failed" ? "ok" : p));
    });
  }

  function handleBrainInterviewComplete(newProfile: PreferenceProfile) {
    clearPendingProfile(user?.id ?? null);
    setState((s) => ({ ...s, profile: newProfile, pendingProfile: null }));
    markLanding();
    router.push("/results");
    captureUsageEvent("interview_completed");
    persistProfile(newProfile);
  }

  function handleUpdateProfile(updated: PreferenceProfile) {
    setState((s) => ({ ...s, profile: updated }));
    persistProfile(updated);
  }

  /** A change worked out on whatever the profile is by now — for a result that lands after the screen asking for it closed. */
  function handleUpdateProfileWith(update: (latest: PreferenceProfile) => PreferenceProfile) {
    const latest = latestProfileRef.current;
    if (latest) handleUpdateProfile(update(latest));
  }

  /** Tells the fleet learning which interview values the pilot changed, and where those values had come from. */
  function reportCorrections(before: PreferenceProfile, after: PreferenceProfile) {
    if (!bidPack || !isLearnablePack(bidPack)) return;
    postCorrections({ base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat }, correctionEvents(before, after));
  }

  function handleSaveProfileEdits(edits: ProfileEdits) {
    if (!state.profile) return;
    const updated = applyManualEdits(state.profile, edits);
    reportCorrections(state.profile, updated);
    handleUpdateProfile(updated);
  }

  function handleSaveSeniority(input: SeniorityInput) {
    saveSeniority(user?.id ?? null, input);
    setState((s) => ({ ...s, seniority: input }));
  }

  function handleStartInterview() {
    setInterviewKey((k) => k + 1);
    clearPendingProfile(user?.id ?? null);
    setState((s) => ({ ...s, pendingProfile: null, freshBidPack: false }));
    router.push("/interview");
  }

  function handleAcknowledgeFreshBidPack() {
    setState((s) => (s.freshBidPack ? { ...s, freshBidPack: false } : s));
  }

  function handleStartOver() {
    // All of it, for every pack, as the dialog says — not only the pack and profile: tiers and starred lines kept by
    // the pack's id came back with the same month's pack uploaded again. The sign-in stays.
    forgetPilotWork(user?.id ?? null);
    // Any other tab open on it drops it too, rather than put it back with its next star or tick (`onStartOverElsewhere`).
    announceStartOver(user?.id ?? null);
    // The calendar link showed the line the deleted ranking put first: it's turned off (and the device forgets what it
    // last sent it, with the rest, in `forgetPilotWork`), and kept owed until that gets through. Fetched when needed, not
    // shipped on every screen.
    if (user) {
      oweFeedOff(user.id);
      void import("@/lib/calendar-feed-client").then(({ turnOffFeedForStartOver }) => turnOffFeedForStartOver(user.id)).catch(() => {});
    }
    if (user) void clearServerBidPack(user.id);
    if (user && bidPack) void clearTradeHolding(bidPack.id);
    if (user && bidPack) void clearServerDraft(bidPack.id);
    clearPendingProfile(user?.id ?? null);
    setInterviewKey((k) => k + 1);
    setState((s) => ({ ...s, profile: null, bidPack: null, pendingProfile: null, seniority: null, freshBidPack: false }));
    // Signed in, the landing page is for someone else: on to the upload, inside the app.
    router.push(user ? "/upload" : "/");
    void clearProfileForUser(user?.id ?? null);
  }

  // Two independent dismissals, not one shared flag reset — a pilot
  // dismissing the bid-pack warning must not silently also clear the
  // profile-save warning (and lose their only notice that a finished
  // profile won't survive a refresh) without ever seeing it.
  function handleDismissBidPackSaveWarning() {
    setState((s) => ({ ...s, bidPackSaveFailed: false }));
  }

  function handleDismissProfileSaveWarning() {
    setState((s) => ({ ...s, profileSaveFailed: false }));
  }

  function handleDismissListSaveWarning() {
    setListSaveFailed(false);
  }

  function handleDismissProfileSync() {
    setProfileSync((p) => (p === "merged" ? "ok" : p));
  }

  function handleDismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function handleToastClick(id: string) {
    const href = toasts.find((t) => t.id === id)?.href;
    handleDismissToast(id);
    if (href !== null) router.push(href ?? "/inbox");
  }

  async function handleAuthenticated(newUser: UserAccount, { stay = false, from }: { stay?: boolean; from?: GuestWork } = {}): Promise<string> {
    const signIn = ++signInsRef.current;
    // The session is this account's now, and so is every call from here on: the ones just below that bring in its pack
    // and profile among them.
    setShownAccount(newUser.id);
    // What was on screen before this sign-in; on a load finishing a confirm's sign-in, what the guest had on this device.
    const before: GuestWork = from ?? { user: state.user, bidPack: state.bidPack, profile: state.profile, seniority: state.seniority };
    askToKeepStorage();
    identifyPilot(newUser.id);
    const account = await accountBidPack(newUser.id);
    let theirBidPack = account.pack;
    let theirProfile = await loadProfileForUser(newUser.id);
    let theirSeniority = loadSeniority(newUser.id);
    let packSaveFailed = account.saveFailed;
    // Read once and cleared: whatever this sign-in does with the guest's upload, the next one mustn't take it over too.
    const guestUpload = guestUploadedPackId();
    clearGuestUpload();
    // The account holds another pack than the one the guest loaded: it comes up, and they're asked which to go on with.
    const offered = guestPackToOffer(before, account.pack, guestUpload);

    // A guest who uploaded a pack and answered the interview, then makes an account so it "follows them to a new device", must not land on an empty app. An account that has nothing of its own adopts what the guest was just working on; one that already has data keeps it untouched.
    if (!before.user) {
      // What the account takes over stops being the guest's, so signing out later really does take it off the screen.
      // Only a pack this guest uploaded here, and only to an account the server said holds none: a fetch that failed
      // would put it over the account's own, and a guest pack shown after an earlier account signed out isn't this
      // pilot's to take.
      const guestsOwnUpload = before.bidPack && !isSamplePack(before.bidPack) && before.bidPack.id === guestUpload;
      if (!theirBidPack && account.noneOnAccount && guestsOwnUpload && before.bidPack) {
        // The guest's copy goes first: two copies of a big pack don't fit in the browser's storage together.
        clearBidPack(null);
        if (!(await saveBidPack(newUser.id, before.bidPack))) {
          packSaveFailed = true;
          await saveBidPack(null, before.bidPack);
        }
        void saveServerBidPack(before.bidPack, newUser.id);
        // Their stars, hidden lines, tiers, own order, sort and carry-in on it come with it.
        moveGuestWorkToAccount(before.bidPack.id, newUser.id);
        theirBidPack = before.bidPack;
      }
      // The account holds the pack the guest just loaded here: an interview they did on it since the account's last
      // one is the one to go on with, as taking the pack over from the dialog makes it. Without this it sat hidden on
      // the device behind the account's older one.
      const onSamePack = guestsOwnUpload && before.bidPack && theirBidPack && isPackId(theirBidPack.id, before.bidPack);
      const guestsInterview = onSamePack && before.bidPack && theirProfile ? profileWithGuestPack(before.bidPack, before.profile, theirProfile) : theirProfile;
      if (!theirProfile && before.profile) {
        if ((await saveProfileForUser(newUser.id, before.profile)).savedLocally) clearProfile(null);
        theirProfile = before.profile;
      } else if (guestsInterview && guestsInterview !== theirProfile) {
        const saved = await saveProfileForUser(newUser.id, guestsInterview);
        if (saved.savedLocally) clearProfile(null);
        theirProfile = saved.profile;
      } else if (theirProfile && before.profile) {
        // The account's own profile stands, but the months the guest logged and the checklist they ticked join it:
        // otherwise they'd sit hidden on the device behind the account's, and go with it at sign-out.
        // Once the account's copy holds them, the guest's copy gives them up, or the next sign-in here adds them again.
        const withGuest = withGuestRecords(theirProfile, before.profile);
        if (withGuest !== theirProfile) {
          const saved = await saveProfileForUser(newUser.id, withGuest);
          theirProfile = saved.profile;
          if (saved.savedLocally) dropGuestRecords();
        }
      }
      if (!theirSeniority && before.seniority) {
        saveSeniority(newUser.id, before.seniority);
        theirSeniority = before.seniority;
      }
      adoptGuestDrafts(newUser.id);
    }
    // Only now on the device's note of who's signed in: another tab of this guest's hears of the sign-in from it and
    // loads the account (`onSignedInElsewhere`). Told before, it found the account still empty and showed "upload your
    // bid pack" where the guest's lines were. Not once this tab has signed out or in again meanwhile: it'd put this
    // account back on the device.
    if (signInsRef.current === signIn) writeSignedInHint(newUser);

    if (hasUnsyncedProfile(newUser.id)) setProfileSync("failed");
    setState({
      ready: true,
      profile: theirProfile,
      user: newUser,
      bidPack: theirBidPack,
      parseResult: null,
      pendingProfile: null,
      seniority: theirSeniority,
      freshBidPack: false,
      bidPackSaveFailed: packSaveFailed,
      profileSaveFailed: false,
    });
    setGuestOffer(offered ? { userId: newUser.id, pack: offered, profile: before.profile } : null);
    // The guest's work has joined the account: a load from here on has nothing left to finish.
    try {
      if (window.localStorage.getItem(CONFIRM_SIGN_IN_KEY) === newUser.id) window.localStorage.removeItem(CONFIRM_SIGN_IN_KEY);
    } catch {
      // Private mode: there was nothing written to clear.
    }
    const landing = landingAfterSignIn(theirBidPack, theirProfile, before.user ? null : before.bidPack);
    if (!stay) router.push(landing);
    return landing;
  }

  /**
   * "Use the one I loaded": the guest's pack becomes the account's, as an upload signed in makes it, with what they did
   * on it (stars, tiers, the interview draft) and, done on it after the account's last one, their interview.
   */
  async function handleTakeGuestPack() {
    const offer = guestOffer;
    setGuestOffer(null);
    if (!offer || userIdRef.current !== offer.userId) return;
    const asked = signInsRef.current;
    const { userId: owner, pack } = offer;
    // The guest's copy goes first: two copies of a big pack don't fit in the browser's storage together.
    clearBidPack(null);
    const saved = await saveBidPack(owner, pack);
    if (!saved) await saveBidPack(null, pack);
    if (signInsRef.current !== asked) return;
    void saveServerBidPack(pack, owner);
    moveGuestWorkToAccount(pack.id, owner);
    const account = latestProfileRef.current;
    let profile = profileWithGuestPack(pack, offer.profile, account);
    if (profile && profile !== account) {
      const r = await saveProfileForUser(owner, profile);
      if (signInsRef.current !== asked) return;
      if (r.savedLocally) clearProfile(null);
      profile = r.profile;
    }
    setState((s) => (s.user?.id !== owner ? s : { ...s, bidPack: pack, profile, parseResult: null, pendingProfile: loadPendingProfile(owner, pack.id), freshBidPack: false, bidPackSaveFailed: !saved }));
    router.push(landingPathFor(pack, profile));
  }

  /** "Keep my account's": as it is; the one the guest loaded stays on this device, theirs again once signed out. */
  function handleKeepAccountPack() {
    setGuestOffer(null);
  }

  /** The answer, for a caller that keeps asking: confirmed (or someone else now), still waiting, nobody signed in, or no answer. */
  async function refreshUser(): Promise<"confirmed" | "waiting" | "signed-out" | "unknown"> {
    const asked = signInsRef.current;
    const session = await checkSession();
    // Signed out (or in) on this tab while it was on its way: it says who was signed in before. Written down now, it
    // put the pilot who just left back on this device, for the next person here to be shown when offline.
    if (signInsRef.current !== asked) return "unknown";
    // Signed in as someone else (or out) in another tab since this one last asked: this tab shows what a fresh load
    // would. Without a signal, it goes by who the other tab wrote down as signed in, as a load does.
    const shown = shownAccount();
    const here = signedInHere();
    const now = session.reachable ? session.user : here === undefined ? undefined : readLastUser();
    if (shown !== undefined && now !== undefined && (now?.id ?? null) !== shown) await showAccountNow(now);
    if (!session.reachable) return "unknown";
    if (!session.user) return "signed-out";
    const fresh = session.user;
    setState((s) => (s.user && s.user.id === fresh.id && standingChanged(s.user, fresh) ? { ...s, user: fresh } : s));
    writeSignedInHint(fresh);
    return fresh.emailVerified === false ? "waiting" : "confirmed";
  }


  async function handleContinueAsGuest() {
    // Signed in, carrying on as a guest means signing out first: the guest's pack and profile under the account's
    // name would be saved over the account's own at the next edit.
    if (state.user) return handleLogout();
    const guestBidPack = await loadBidPack(null);
    const guestProfile = await loadProfileForUser(null);
    setState((s) => ({
      ...s,
      profile: guestProfile,
      bidPack: guestBidPack,
      seniority: loadSeniority(null),
    }));
    router.push(landingPathFor(guestBidPack, guestProfile));
  }

  async function handleLogout(opts?: { to?: string }) {
    // Someone else signed in in another tab since: their session isn't this tab's to end. It shows them, as a fresh load
    // would, rather than signing the whole browser out from under them.
    const ended = await logoutAccount(user?.id);
    if (ended === "other") {
      await refreshUser();
      return;
    }
    // Offline, the session cookie outlives a sign-out that only happened on screen: the next person to open the app
    // here would be let back into this account. Stay signed in and say so. Still the same session, so an answer on its
    // way about it (the account's pack once the connection is back, say) still counts: counted as a sign-out, it was
    // dropped, and the device's older copy stayed on screen.
    if (!ended) {
      setToasts((prev) => [...prev, { id: `logout-${Date.now()}`, title: "Couldn't sign out", body: "Check your connection and try again. You're still signed in.", href: null }]);
      return;
    }
    signInsRef.current++;
    // What this device kept for them goes too — the next person here mustn't find their pack or their own words. Not
    // while an edit is still waiting to reach their account: then this device holds the only copy. The mark is read
    // too, not just this visit's state, so an edit left from an earlier visit is kept as well.
    if (user && profileSync !== "failed" && !hasUnsyncedProfile(user.id)) forgetPilotOnDevice(user.id);
    // Passed as a click handler, it's handed the click: only a path asked for by name is gone to.
    await showSignedOut(typeof opts?.to === "string" ? opts.to : undefined);
  }

  /** The guest view, once the server no longer holds a session for this device; at `to`, or wherever a guest belongs. */
  async function showSignedOut(to?: string) {
    signInsRef.current++;
    setGuestOffer(null);
    setShownAccount(null);
    setProfileSync("ok");
    writeSignedInHint(null);
    // The account's copy isn't what a guest's next save starts from, and the guest pack shown now (kept from before the
    // account signed in) isn't one for the next account to take over.
    forgetLastKnownProfile();
    clearGuestUpload();
    resetPilotIdentity();
    await showGuest(to);
  }

  /** The guest's own pack and profile from this device, at `to` or wherever a guest belongs. */
  async function showGuest(to?: string) {
    const asked = signInsRef.current;
    const guestBidPack = await loadBidPack(null);
    const guestProfile = await loadProfileForUser(null);
    if (signInsRef.current !== asked) return;
    setState({
      ready: true,
      profile: guestProfile,
      seniority: loadSeniority(null),
      user: null,
      bidPack: guestBidPack,
      parseResult: null,
      pendingProfile: null,
      freshBidPack: false,
      bidPackSaveFailed: false,
      profileSaveFailed: false,
    });
    router.push(to ?? landingPathFor(guestBidPack, guestProfile));
  }

  /**
   * Another tab signed in as `now` (or signed out: null) since this one showed its account. What this tab holds goes
   * from the screen, and it shows what a fresh load would. Nothing kept on the device is touched: the other tab did all
   * that signing in or out does, and the old account's own copies stay its own (an edit not yet on its account among
   * them) for the next time it signs in here. Nothing of the old account's goes into the new one.
   */
  async function showAccountNow(now: UserAccount | null) {
    const asked = ++signInsRef.current;
    // Asked for the sign-in on this tab only: signed in again from another, the pack it asked about may be gone or
    // taken over there.
    setGuestOffer(null);
    setShownAccount(now?.id ?? null);
    // Read by a save of the old account's that comes back now: it says nothing about the new one's.
    userIdRef.current = now?.id ?? null;
    writeSignedInHint(now);
    forgetLastKnownProfile();
    setInterviewKey((k) => k + 1);
    setProfileSync("ok");
    setListSaveFailed(false);
    // Off the screen at once, as on a fresh load: no tap meanwhile on the old account's pack or profile ("Start over"
    // among them) goes up as the new account's.
    setState(NOT_LOADED);
    if (!now) {
      resetPilotIdentity();
      return showGuest();
    }
    identifyPilot(now.id);
    const resolved = await loadStateFor(now);
    if (signInsRef.current !== asked) return;
    setState(resolved);
    if (hasUnsyncedProfile(now.id)) setProfileSync("failed");
  }

  /**
   * The server answers again after a load that had only this device's copies: who's signed in is asked (signed out
   * elsewhere, it's the guest view now), then the account's pack and profile replace the device's where nothing has
   * changed them since.
   */
  async function catchUpAfterOfflineLoad(was: OfflineLoad) {
    const answer = await refreshUser();
    if (answer === "unknown") {
      // Still no answer: asked again the next time the connection comes back.
      if (!offlineLoadRef.current && shownAccount() === was.userId) offlineLoadRef.current = was;
      return;
    }
    if (answer === "signed-out" || shownAccount() !== was.userId) return;
    const asked = signInsRef.current;
    // An edit since, or one still waiting to reach the account, is the profile to keep: the account's isn't asked for.
    const untouched = latestProfileRef.current === was.profile && !hasUnsyncedProfile(was.userId);
    const [pack, profile] = await Promise.all([accountBidPack(was.userId), untouched ? loadProfileForUser(was.userId) : null]);
    if (signInsRef.current !== asked) return;
    // Edited while the account's copy was on its way: what this device keeps is that edit, not the copy just read.
    if (untouched && latestProfileRef.current !== was.profile && latestProfileRef.current) saveProfile(was.userId, latestProfileRef.current);
    setState((s) => caughtUpState(s, was, { bidPack: pack.pack, profile, pendingFor: (packId) => loadPendingProfile(was.userId, packId) }));
  }

  useEffect(() => {
    showAccountNowRef.current = (now) => void showAccountNow(now);
    adoptOnLoadRef.current = (user, from) => handleAuthenticated(user, { stay: true, from });
    catchUpRef.current = catchUpAfterOfflineLoad;
  });

  useEffect(() => {
    const was = offlineLoadRef.current;
    if (offlineNow || !state.ready || !was) return;
    offlineLoadRef.current = null;
    void catchUpRef.current(was);
  }, [offlineNow, state.ready]);

  // An address confirmed in another tab or on another device: the notice and the Trade Board's banner go as soon as
  // this tab is looked at again, or the confirm page says so, rather than waiting for a reload.
  const waitingOnConfirm = state.user?.emailVerified === false;
  const refreshUserRef = useRef(refreshUser);
  useEffect(() => {
    refreshUserRef.current = refreshUser;
  });

  useEffect(() => {
    // Another pilot signed in (or this one out) in another tab of this browser: the cookie is theirs now, and the pack,
    // profile and lists on this tab's screen are the old account's. The server refuses this tab's calls meanwhile
    // (`apiFetch`), and the tab asks who's signed in as soon as it hears: the other tab's note on the device, being
    // looked at again after the browser put it to sleep, or a call refused. Then it shows that (`refreshUser`).
    if (!state.ready) return;
    const ask = () => void refreshUserRef.current();
    const stopRefused = onAccountRefused(ask);
    const stopElsewhere = onSignedInElsewhere(userId, signedInHere, ask);
    return () => {
      stopRefused();
      stopElsewhere();
    };
  }, [state.ready, userId]);
  useEffect(() => {
    if (!waitingOnConfirm) return;
    const ask = () => void refreshUserRef.current();
    const onVisible = () => document.visibilityState === "visible" && ask();
    const onStorage = (e: StorageEvent) => e.key === EMAIL_CONFIRMED_KEY && ask();
    window.addEventListener("focus", ask);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", ask);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [waitingOnConfirm]);

  const value: AppStateValue = {
    ...state,
    interviewKey,
    demoOffer,
    toasts,
    inboxUnreadCount,
    tradeOffers: realOffers,
    profileSync,
    listSaveFailed,
    handleDismissListSaveWarning,
    refreshTradeActivity: () => void tradePollRef.current?.(),
    handleDismissProfileSync,
    handleAcceptDemoOffer,
    handleParsed,
    handleTrySample,
    handleBidPackConfirmed,
    handleUploadDifferent,
    handleInterviewComplete,
    handleConfirmPreferences,
    handleBrainInterviewComplete,
    handleUpdateProfile,
    handleUpdateProfileWith,
    handleSaveProfileEdits,
    handleSaveSeniority,
    handleStartInterview,
    handleAcknowledgeFreshBidPack,
    handleStartOver,
    handleDismissBidPackSaveWarning,
    handleDismissProfileSaveWarning,
    handleDismissToast,
    handleToastClick,
    handleAuthenticated,
    // Only while the account it was asked for is the one shown.
    guestPackOffer: guestOffer && user?.id === guestOffer.userId ? guestOffer.pack : null,
    handleTakeGuestPack: () => void handleTakeGuestPack(),
    handleKeepAccountPack,
    refreshUser,
    handleContinueAsGuest,
    handleLogout,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export { landingPathFor };
