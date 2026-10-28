"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkSession, logout as logoutAccount } from "@/lib/auth";
import { clearBidPack, loadBidPack, saveBidPack } from "@/lib/bidpack-storage";
import { generateFakeOffer } from "@/lib/fake-trade-offers";
import { computeInboxSections, sameBidPack } from "@/lib/inbox";
import { correctionEvents, isLearnablePack } from "@/lib/learning/corrections";
import { postCorrections } from "@/lib/learning/learning-client";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import { captureUsageEvent, identifyPilot, resetPilotIdentity } from "@/lib/posthog-client";
import { clearPendingProfile, loadPendingProfile, savePendingProfile } from "@/lib/pending-profile-storage";
import { applyManualEdits, type ProfileEdits } from "@/lib/profile-edits";
import { loadSeniority, saveSeniority } from "@/lib/seniority-storage";
import { clearProfileForUser, loadProfileForUser, saveProfileForUser } from "@/lib/storage";
import { fetchTradeOffers, tripToSnapshot } from "@/lib/trade-client";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";
import type { TradeOffer } from "@/types/trade";
import type { ToastItem } from "@/components/ui/Toast";

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

function readLastUser(): UserAccount | null {
  try {
    const raw = window.localStorage.getItem(LAST_USER_KEY);
    const user = raw ? (JSON.parse(raw) as UserAccount) : null;
    return user && typeof user.id === "string" ? user : null;
  } catch {
    return null;
  }
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

/** Where a pilot with this bid pack/profile combination actually belongs — the same "resume point" logic used both on first load and after sign-in/sign-out. */
function landingPathFor(bidPack: BidPack | null, profile: PreferenceProfile | null): string {
  if (!bidPack) return "/";
  return profile ? "/results" : "/preferences";
}

interface AppStateValue extends DataState {
  interviewKey: number;
  demoOffer: TradeOffer | null;
  toasts: ToastItem[];
  inboxUnreadCount: number;
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
  handleSaveProfileEdits: (edits: ProfileEdits) => void;
  handleSaveSeniority: (input: SeniorityInput) => void;
  handleStartInterview: () => void;
  handleAcknowledgeFreshBidPack: () => void;
  handleStartOver: () => void;
  handleDismissBidPackSaveWarning: () => void;
  handleDismissProfileSaveWarning: () => void;
  handleDismissToast: (id: string) => void;
  handleToastClick: (id: string) => void;
  handleAuthenticated: (newUser: UserAccount) => void;
  handleContinueAsGuest: () => void;
  handleLogout: () => Promise<void>;
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
  const [state, setState] = useState<DataState>({
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
  });
  const { user, bidPack, pendingProfile } = state;
  const [interviewKey, setInterviewKey] = useState(0);
  const [demoOffer, setDemoOffer] = useState<TradeOffer | null>(null);
  const [realOffers, setRealOffers] = useState<TradeOffer[]>([]);
  const [seenOfferIds, setSeenOfferIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const realOffersRef = useRef<TradeOffer[]>([]);
  const knownNotifiableIdsRef = useRef<Set<string> | null>(null);
  const onTradeBoard = usePathname() === "/trade-board";
  /** Which pack (and pilot) the current example offer was made for. */
  const demoOfferKey = useRef<string | null>(null);
  const pathnameRef = useRef<string>("/");
  if (typeof window !== "undefined") pathnameRef.current = window.location.pathname;

  useEffect(() => {
    // One-time read of external stores (server session + localStorage) to
    // resolve the initial profile/bidPack/user — can't happen during render
    // since it would mismatch the server-rendered "not ready yet" state.
    let cancelled = false;
    const stateFor = async (currentUser: UserAccount | null): Promise<DataState> => {
      const savedBidPack = loadBidPack(currentUser?.id ?? null);
      return {
        ready: true,
        profile: await loadProfileForUser(currentUser?.id ?? null),
        user: currentUser,
        bidPack: savedBidPack,
        parseResult: null,
        // A finished-but-unconfirmed interview survives a refresh on the confirmation screen.
        pendingProfile: loadPendingProfile(currentUser?.id ?? null, savedBidPack?.id ?? null),
        seniority: loadSeniority(currentUser?.id ?? null),
        freshBidPack: false,
        bidPackSaveFailed: false,
        profileSaveFailed: false,
      };
    };
    async function bootstrap() {
      // A device that wasn't signed in last time is almost certainly a guest now, and a guest's pack and profile are
      // all on this device — so show them straight away instead of waiting on the session check (which takes a second
      // or more when the server is cold). If the check then finds an account after all, its data replaces them.
      const assumedGuest = !readSignedInHint();
      if (assumedGuest) {
        const guest = await stateFor(null);
        if (!cancelled) setState(guest);
      }
      const session = await checkSession();
      if (cancelled) return;
      // No answer from the server (no signal): carry on as the account this device was last signed in to, rather than
      // dropping a signed-in pilot to an empty guest view until the connection comes back.
      const currentUser = session.reachable ? session.user : readLastUser();
      if (session.reachable) writeSignedInHint(currentUser);
      if (currentUser) identifyPilot(currentUser.id);
      if (assumedGuest && !currentUser) return;
      const resolved = await stateFor(currentUser);
      if (!cancelled) setState(resolved);
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Demo-only: rotates a synthetic Trade Board offer every 15-20s so the
    // accept flow has something to interact with before real pilots are
    // using the board. Never touches the server. Cleared entirely once
    // there's no bid pack to build fake offers from.
    if (!bidPack) {
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
    const packKey = `${bidPack.base}|${bidPack.aircraft}|${bidPack.seat}|${bidPack.month}|${user?.id ?? ""}`;
    if (demoOfferKey.current !== packKey) {
      demoOfferKey.current = packKey;
      rotate(onTradeBoard);
    } else if (onTradeBoard) {
      timeoutId = setTimeout(() => rotate(true), 15000 + Math.random() * 5000);
    }
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidPack?.base, bidPack?.aircraft, bidPack?.seat, bidPack?.month, user?.id, onTradeBoard]);

  useEffect(() => {
    // Polls real trade offers (independent of the demo rotation above) so
    // the Inbox badge and toast notifications react to real pilot activity,
    // not just to screens that happen to be mounted.
    if (!user || !bidPack) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRealOffers([]);
      return;
    }
    let cancelled = false;
    let last = "";
    async function poll() {
      // Not while the tab is in the background, and no state change when nothing changed — an unchanged poll used to
      // re-render the whole app every ten seconds.
      if (document.visibilityState === "hidden") return;
      const data = await fetchTradeOffers();
      const signature = JSON.stringify(data);
      if (cancelled || signature === last) return;
      last = signature;
      setRealOffers(data);
    }
    poll();
    const intervalId = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [user, bidPack]);

  useEffect(() => {
    realOffersRef.current = realOffers;
  }, [realOffers]);

  const notifiableOffers = useMemo(() => {
    if (!bidPack || !user) return [];
    const visible = realOffers.filter((o) => sameBidPack(o, bidPack));
    // Example offers never notify — a real pilot shouldn't get a toast or an
    // unread badge for a trade offer that doesn't exist.
    const { needsResponse, directInterest } = computeInboxSections(visible, user.id);
    const byId = new Map<string, TradeOffer>();
    for (const offer of [...needsResponse, ...directInterest]) byId.set(offer.id, offer);
    return [...byId.values()];
  }, [realOffers, bidPack, user]);

  const inboxUnreadCount = notifiableOffers.filter((o) => !seenOfferIds.has(o.id)).length;

  useEffect(() => {
    // Only the Inbox counts as "checked" — the Trade Board shows the same
    // offers, but browsing it isn't the same deliberate act as opening your
    // notifications, so a Trade Board visit alone shouldn't clear the badge.
    if (pathnameRef.current !== "/inbox") return;
    if (notifiableOffers.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeenOfferIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const offer of notifiableOffers) {
        if (!next.has(offer.id)) {
          next.add(offer.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [notifiableOffers]);

  useEffect(() => {
    // Toasts only a brand-new arrival (never the pre-existing backlog found
    // on first load), and only while the pilot isn't already looking at the
    // Inbox itself — the Trade Board still gets toasts, since browsing it
    // no longer counts as having checked notifications (see above).
    const currentIds = new Set(notifiableOffers.map((o) => o.id));
    if (knownNotifiableIdsRef.current === null) {
      knownNotifiableIdsRef.current = currentIds;
      return;
    }
    const newOnes = notifiableOffers.filter((o) => !knownNotifiableIdsRef.current!.has(o.id));
    knownNotifiableIdsRef.current = currentIds;
    if (newOnes.length === 0 || pathnameRef.current === "/inbox") return;
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
  }, [notifiableOffers]);

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
        responderTrip: tripToSnapshot(responder.trip, responder.lineNumber),
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
    // Deliberately does NOT clear the existing profile: a new bid pack
    // almost always means a new bidding cycle for a pilot who's used this
    // app before, not a brand-new pilot. The old profile stays in state so
    // the next interview receives it as `priorProfile` and can actually
    // fold cross-cycle history (reaffirmed facts, contradictions) instead
    // of starting from zero every month — the entire point of that
    // machinery, which a blanket clear here used to defeat on every single
    // confirm. `handleStartOver` is the deliberate, explicit reset instead.
    const saved = saveBidPack(user?.id ?? null, newBidPack);
    clearPendingProfile(user?.id ?? null);
    setState((s) => ({
      ...s,
      bidPackSaveFailed: !saved,
      bidPack: newBidPack,
      parseResult: null,
      pendingProfile: null,
      freshBidPack: true,
    }));
    router.push("/preferences");
    captureUsageEvent("bid_pack_confirmed");
  }

  function handleUploadDifferent() {
    setState((s) => ({ ...s, parseResult: null }));
    router.push("/upload");
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
    router.push("/results");
    captureUsageEvent("interview_completed");
    const signedIn = !!user?.id;
    saveProfileForUser(user?.id ?? null, confirmed).then((savedLocally) => {
      // A signed-in pilot's profile also lives on the server, so a local
      // miss here is cosmetic; for a guest, local storage is the only copy.
      if (!savedLocally && !signedIn) setState((s) => ({ ...s, profileSaveFailed: true }));
    });
  }

  function handleBrainInterviewComplete(newProfile: PreferenceProfile) {
    clearPendingProfile(user?.id ?? null);
    setState((s) => ({ ...s, profile: newProfile, pendingProfile: null }));
    router.push("/results");
    captureUsageEvent("interview_completed");
    const signedIn = !!user?.id;
    saveProfileForUser(user?.id ?? null, newProfile).then((savedLocally) => {
      if (!savedLocally && !signedIn) setState((s) => ({ ...s, profileSaveFailed: true }));
    });
  }

  function handleUpdateProfile(updated: PreferenceProfile) {
    setState((s) => ({ ...s, profile: updated }));
    const signedIn = !!user?.id;
    saveProfileForUser(user?.id ?? null, updated).then((savedLocally) => {
      if (!savedLocally && !signedIn) setState((s) => ({ ...s, profileSaveFailed: true }));
    });
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
    clearBidPack(user?.id ?? null);
    clearPendingProfile(user?.id ?? null);
    setInterviewKey((k) => k + 1);
    setState((s) => ({ ...s, profile: null, bidPack: null, pendingProfile: null, freshBidPack: false }));
    router.push("/");
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

  function handleDismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function handleToastClick(id: string) {
    handleDismissToast(id);
    router.push("/inbox");
  }

  async function handleAuthenticated(newUser: UserAccount) {
    writeSignedInHint(newUser);
    identifyPilot(newUser.id);
    let theirBidPack = loadBidPack(newUser.id);
    let theirProfile = await loadProfileForUser(newUser.id);
    let theirSeniority = loadSeniority(newUser.id);

    // A guest who uploaded a pack and answered the interview, then makes an account so it "follows them to a new device", must not land on an empty app. An account that has nothing of its own adopts what the guest was just working on; one that already has data keeps it untouched.
    if (!state.user) {
      if (!theirBidPack && state.bidPack && !state.bidPack.id.startsWith("sample")) {
        saveBidPack(newUser.id, state.bidPack);
        theirBidPack = state.bidPack;
      }
      if (!theirProfile && state.profile) {
        await saveProfileForUser(newUser.id, state.profile);
        theirProfile = state.profile;
      }
      if (!theirSeniority && state.seniority) {
        saveSeniority(newUser.id, state.seniority);
        theirSeniority = state.seniority;
      }
    }

    setState({
      ready: true,
      profile: theirProfile,
      user: newUser,
      bidPack: theirBidPack,
      parseResult: null,
      pendingProfile: null,
      seniority: theirSeniority,
      freshBidPack: false,
      bidPackSaveFailed: false,
      profileSaveFailed: false,
    });
    router.push(landingPathFor(theirBidPack, theirProfile));
  }

  async function handleContinueAsGuest() {
    const guestBidPack = loadBidPack(null);
    const guestProfile = await loadProfileForUser(null);
    setState((s) => ({
      ...s,
      profile: guestProfile,
      bidPack: guestBidPack,
      seniority: loadSeniority(null),
    }));
    router.push(landingPathFor(guestBidPack, guestProfile));
  }

  async function handleLogout() {
    await logoutAccount();
    writeSignedInHint(null);
    resetPilotIdentity();
    const guestBidPack = loadBidPack(null);
    const guestProfile = await loadProfileForUser(null);
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
    router.push(landingPathFor(guestBidPack, guestProfile));
  }

  const value: AppStateValue = {
    ...state,
    interviewKey,
    demoOffer,
    toasts,
    inboxUnreadCount,
    handleAcceptDemoOffer,
    handleParsed,
    handleTrySample,
    handleBidPackConfirmed,
    handleUploadDifferent,
    handleInterviewComplete,
    handleConfirmPreferences,
    handleBrainInterviewComplete,
    handleUpdateProfile,
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
    handleContinueAsGuest,
    handleLogout,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export { landingPathFor };
