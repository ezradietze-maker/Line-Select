"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentUser, logout as logoutAccount } from "@/lib/auth";
import { clearBidPack, loadBidPack, saveBidPack } from "@/lib/bidpack-storage";
import { generateFakeOffer } from "@/lib/fake-trade-offers";
import { computeInboxSections, sameBidPack } from "@/lib/inbox";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import { captureUsageEvent, identifyPilot, resetPilotIdentity } from "@/lib/posthog-client";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { loadSeniority, saveSeniority } from "@/lib/seniority-storage";
import { clearProfileForUser, loadProfileForUser, saveProfileForUser } from "@/lib/storage";
import { fetchTradeOffers, tripToSnapshot } from "@/lib/trade-client";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";
import type { TradeOffer } from "@/types/trade";
import type { ToastItem } from "@/components/ui/Toast";

interface DataState {
  ready: boolean;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  bidPack: BidPack | null;
  parseResult: ParseBidPackResult | null;
  /** The just-finished interview's profile, awaiting confirmation before it's saved. */
  pendingProfile: PreferenceProfile | null;
  seniority: SeniorityInput | null;
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
  handleUpdateProfile: (updated: PreferenceProfile) => void;
  handleSaveSeniority: (input: SeniorityInput) => void;
  handleStartInterview: () => void;
  handleStartOver: () => void;
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
  });
  const { user, bidPack, pendingProfile } = state;
  const [interviewKey, setInterviewKey] = useState(0);
  const [demoOffer, setDemoOffer] = useState<TradeOffer | null>(null);
  const [realOffers, setRealOffers] = useState<TradeOffer[]>([]);
  const [seenOfferIds, setSeenOfferIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const realOffersRef = useRef<TradeOffer[]>([]);
  const knownNotifiableIdsRef = useRef<Set<string> | null>(null);
  const pathnameRef = useRef<string>("/");
  if (typeof window !== "undefined") pathnameRef.current = window.location.pathname;

  useEffect(() => {
    // One-time read of external stores (server session + localStorage) to
    // resolve the initial profile/bidPack/user — can't happen during render
    // since it would mismatch the server-rendered "not ready yet" state.
    let cancelled = false;
    async function bootstrap() {
      const currentUser = await getCurrentUser();
      if (cancelled) return;
      if (currentUser) identifyPilot(currentUser.id);
      const savedBidPack = loadBidPack(currentUser?.id ?? null);
      const savedProfile = await loadProfileForUser(currentUser?.id ?? null);
      const savedSeniority = loadSeniority(currentUser?.id ?? null);
      setState({
        ready: true,
        profile: savedProfile,
        user: currentUser,
        bidPack: savedBidPack,
        parseResult: null,
        pendingProfile: null,
        seniority: savedSeniority,
      });
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDemoOffer(null);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;

    function rotate() {
      if (!bidPack) return;
      const myOpen = user
        ? realOffersRef.current.find((o) => o.offeringUserId === user.id && o.status === "open")
        : undefined;
      setDemoOffer(generateFakeOffer(bidPack, myOpen?.offeredTrip.pairingNumber ?? null));
      timeoutId = setTimeout(rotate, 15000 + Math.random() * 5000);
    }

    rotate();
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidPack?.base, bidPack?.aircraft, bidPack?.seat, bidPack?.month, user?.id]);

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
    async function poll() {
      const data = await fetchTradeOffers();
      if (!cancelled) setRealOffers(data);
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
    const combined = demoOffer && sameBidPack(demoOffer, bidPack) ? [demoOffer, ...visible] : visible;
    const { needsResponse, directInterest } = computeInboxSections(combined, user.id);
    const byId = new Map<string, TradeOffer>();
    for (const offer of [...needsResponse, ...directInterest]) byId.set(offer.id, offer);
    return [...byId.values()];
  }, [realOffers, demoOffer, bidPack, user]);

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
    handleBidPackConfirmed(SAMPLE_BID_PACK);
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
    saveBidPack(user?.id ?? null, newBidPack);
    setState((s) => ({
      ...s,
      bidPack: newBidPack,
      parseResult: null,
      pendingProfile: null,
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
    setState((s) => ({ ...s, pendingProfile: newProfile }));
    router.push("/confirm-preferences");
  }

  function handleConfirmPreferences(weights: PreferenceWeights) {
    if (!pendingProfile) return;
    const confirmed: PreferenceProfile = { ...pendingProfile, weights };
    setState((s) => ({ ...s, profile: confirmed, pendingProfile: null }));
    router.push("/results");
    captureUsageEvent("interview_completed");
    void saveProfileForUser(user?.id ?? null, confirmed);
  }

  function handleUpdateProfile(updated: PreferenceProfile) {
    setState((s) => ({ ...s, profile: updated }));
    void saveProfileForUser(user?.id ?? null, updated);
  }

  function handleSaveSeniority(input: SeniorityInput) {
    saveSeniority(user?.id ?? null, input);
    setState((s) => ({ ...s, seniority: input }));
  }

  function handleStartInterview() {
    setInterviewKey((k) => k + 1);
    setState((s) => ({ ...s, pendingProfile: null }));
    router.push("/interview");
  }

  function handleStartOver() {
    clearBidPack(user?.id ?? null);
    setInterviewKey((k) => k + 1);
    setState((s) => ({ ...s, profile: null, bidPack: null, pendingProfile: null }));
    router.push("/");
    void clearProfileForUser(user?.id ?? null);
  }

  function handleDismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function handleToastClick(id: string) {
    handleDismissToast(id);
    router.push("/inbox");
  }

  async function handleAuthenticated(newUser: UserAccount) {
    identifyPilot(newUser.id);
    const theirBidPack = loadBidPack(newUser.id);
    const theirProfile = await loadProfileForUser(newUser.id);
    setState({
      ready: true,
      profile: theirProfile,
      user: newUser,
      bidPack: theirBidPack,
      parseResult: null,
      pendingProfile: null,
      seniority: loadSeniority(newUser.id),
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
    handleUpdateProfile,
    handleSaveSeniority,
    handleStartInterview,
    handleStartOver,
    handleDismissToast,
    handleToastClick,
    handleAuthenticated,
    handleContinueAsGuest,
    handleLogout,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export { landingPathFor };
