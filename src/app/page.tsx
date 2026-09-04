"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { HotelRatingsScreen } from "@/components/hotels/HotelRatingsScreen";
import { Interview } from "@/components/interview/Interview";
import { LeftNav, type NavTarget } from "@/components/nav/LeftNav";
import { ConfirmPreferencesScreen } from "@/components/preferences/ConfirmPreferencesScreen";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { HowItWorksContent } from "@/components/results/HowItWorks";
import { ResultsView } from "@/components/results/ResultsView";
import { StrategiesScreen } from "@/components/strategies/StrategiesScreen";
import { InboxScreen } from "@/components/trade-board/InboxScreen";
import { TradeBoardScreen } from "@/components/trade-board/TradeBoardScreen";
import { Modal } from "@/components/ui/Modal";
import { ScreenTransition } from "@/components/ui/ScreenTransition";
import { Spinner } from "@/components/ui/Spinner";
import { PreviewScreen } from "@/components/upload/PreviewScreen";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { ToastStack, type ToastItem } from "@/components/ui/Toast";
import { getCurrentUser, logout as logoutAccount } from "@/lib/auth";
import { clearBidPack, loadBidPack, saveBidPack } from "@/lib/bidpack-storage";
import { generateFakeOffer } from "@/lib/fake-trade-offers";
import { computeInboxSections, sameBidPack } from "@/lib/inbox";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { loadSeniority, saveSeniority } from "@/lib/seniority-storage";
import { clearProfile, loadProfile, saveProfile } from "@/lib/storage";
import { fetchTradeOffers, tripToSnapshot } from "@/lib/trade-client";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";
import type { TradeOffer } from "@/types/trade";

type Screen =
  | "loading"
  | "welcome"
  | "auth"
  | "upload"
  | "preview"
  | "preferences"
  | "interview"
  | "confirm-preferences"
  | "results"
  | "strategies"
  | "trade-board"
  | "inbox"
  | "hotel-ratings";

const SIDEBAR_HIDDEN_SCREENS: Screen[] = ["loading", "welcome", "auth"];

/** The linear onboarding spine — a screen change between two entries here
 * gets a directional slide; a jump involving anything outside it (a
 * sidebar nav jump between results/strategies/trade-board/inbox/hotel-
 * ratings, or anything to/from "loading") falls back to a plain cross-fade,
 * since there's no meaningful "forward" or "back" between those. */
const SCREEN_ORDER: Screen[] = [
  "welcome",
  "auth",
  "upload",
  "preview",
  "preferences",
  "interview",
  "confirm-preferences",
  "results",
];

function getDirection(from: Screen, to: Screen): 1 | -1 | 0 {
  const fromIndex = SCREEN_ORDER.indexOf(from);
  const toIndex = SCREEN_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return 0;
  return toIndex > fromIndex ? 1 : -1;
}

function screenToNavTarget(screen: Screen): NavTarget {
  if (screen === "interview" || screen === "confirm-preferences") return "preferences";
  if (screen === "preview") return "upload";
  if (screen === "welcome" || screen === "auth" || screen === "loading") return "upload";
  return screen;
}

interface AppState {
  screen: Screen;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  bidPack: BidPack | null;
  parseResult: ParseBidPackResult | null;
  /** The just-finished interview's profile, awaiting confirmation before it's saved. */
  pendingProfile: PreferenceProfile | null;
  seniority: SeniorityInput | null;
}

function landingScreenFor(bidPack: BidPack | null, profile: PreferenceProfile | null): Screen {
  if (!bidPack) return "welcome";
  return profile ? "results" : "preferences";
}

export default function Home() {
  const [{ screen, profile, user, bidPack, parseResult, pendingProfile, seniority }, setState] =
    useState<AppState>({
      screen: "loading",
      profile: null,
      user: null,
      bidPack: null,
      parseResult: null,
      pendingProfile: null,
      seniority: null,
    });
  const [interviewKey, setInterviewKey] = useState(0);

  // Tracks which screen the transition direction was last computed against,
  // so a screen change can derive its slide direction from the SCREEN_ORDER
  // spine before the new content ever renders — adjusted during render
  // (React's documented pattern for reacting to a prop/state change) rather
  // than in an effect, so the very first paint of the new screen already
  // carries the correct direction instead of flashing a stale one.
  const [renderedScreen, setRenderedScreen] = useState(screen);
  const [screenDirection, setScreenDirection] = useState<1 | -1 | 0>(0);
  if (screen !== renderedScreen) {
    setScreenDirection(getDirection(renderedScreen, screen));
    setRenderedScreen(screen);
  }
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [demoOffer, setDemoOffer] = useState<TradeOffer | null>(null);
  const [realOffers, setRealOffers] = useState<TradeOffer[]>([]);
  const [seenOfferIds, setSeenOfferIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const realOffersRef = useRef<TradeOffer[]>([]);
  const knownNotifiableIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    // One-time read of external stores (server session + localStorage) to
    // pick the initial screen; can't happen during render since it would
    // mismatch the server-rendered "loading" state.
    let cancelled = false;
    async function bootstrap() {
      const currentUser = await getCurrentUser();
      if (cancelled) return;
      const savedBidPack = loadBidPack(currentUser?.id ?? null);
      const savedProfile = savedBidPack ? loadProfile(currentUser?.id ?? null) : null;
      const savedSeniority = loadSeniority(currentUser?.id ?? null);
      setState((s) => {
        // If the pilot already acted (e.g. loaded the sample bid pack)
        // while this async session check was in flight, don't clobber that
        // choice — but still record who's actually signed in, since
        // whatever they just did may have assumed "guest" and should
        // really be attributed to their real account.
        if (s.screen !== "loading") return { ...s, user: currentUser };
        return {
          screen: landingScreenFor(savedBidPack, savedProfile),
          profile: savedProfile,
          user: currentUser,
          bidPack: savedBidPack,
          parseResult: null,
          pendingProfile: null,
          seniority: savedSeniority,
        };
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
    if (screen !== "inbox") return;
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
  }, [screen, notifiableOffers]);

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
    if (newOnes.length === 0 || screen === "inbox") return;
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
  }, [notifiableOffers, screen]);

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
    setState((s) => ({ ...s, screen: "preview", parseResult: result }));
  }

  function handleTrySample() {
    handleBidPackConfirmed(SAMPLE_BID_PACK);
  }

  function handleBidPackConfirmed(newBidPack: BidPack) {
    saveBidPack(user?.id ?? null, newBidPack);
    clearProfile(user?.id ?? null);
    setState((s) => ({
      ...s,
      screen: "preferences",
      bidPack: newBidPack,
      parseResult: null,
      profile: null,
      pendingProfile: null,
    }));
  }

  function handleInterviewComplete(newProfile: PreferenceProfile) {
    // Not saved yet — the pilot reviews (and can still adjust) the
    // summarized weights on the confirmation screen before this counts.
    setState((s) => ({ ...s, screen: "confirm-preferences", pendingProfile: newProfile }));
  }

  function handleConfirmPreferences(weights: PreferenceWeights) {
    if (!pendingProfile) return;
    const confirmed: PreferenceProfile = { ...pendingProfile, weights };
    saveProfile(user?.id ?? null, confirmed);
    setState((s) => ({
      ...s,
      screen: "results",
      profile: confirmed,
      pendingProfile: null,
    }));
  }

  function handleUpdateProfile(updated: PreferenceProfile) {
    saveProfile(user?.id ?? null, updated);
    setState((s) => ({ ...s, profile: updated }));
  }

  function handleSaveSeniority(input: SeniorityInput) {
    saveSeniority(user?.id ?? null, input);
    setState((s) => ({ ...s, seniority: input }));
  }

  function handleStartInterview() {
    setInterviewKey((k) => k + 1);
    setState((s) => ({ ...s, screen: "interview", pendingProfile: null }));
  }

  function handleStartOver() {
    clearProfile(user?.id ?? null);
    clearBidPack(user?.id ?? null);
    setInterviewKey((k) => k + 1);
    setState((s) => ({
      ...s,
      screen: "welcome",
      profile: null,
      bidPack: null,
      pendingProfile: null,
    }));
  }

  function handleNavigate(target: NavTarget) {
    setState((s) => ({ ...s, screen: target }));
  }

  function handleDismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function handleToastClick(id: string) {
    handleDismissToast(id);
    setState((s) => ({ ...s, screen: "inbox" }));
  }

  function handleAuthenticated(newUser: UserAccount) {
    const theirBidPack = loadBidPack(newUser.id);
    const theirProfile = theirBidPack ? loadProfile(newUser.id) : null;
    setState({
      screen: landingScreenFor(theirBidPack, theirProfile),
      profile: theirProfile,
      user: newUser,
      bidPack: theirBidPack,
      parseResult: null,
      pendingProfile: null,
      seniority: loadSeniority(newUser.id),
    });
  }

  function handleContinueAsGuest() {
    const guestBidPack = loadBidPack(null);
    const guestProfile = guestBidPack ? loadProfile(null) : null;
    setState((s) => ({
      ...s,
      screen: landingScreenFor(guestBidPack, guestProfile),
      profile: guestProfile,
      bidPack: guestBidPack,
      seniority: loadSeniority(null),
    }));
  }

  async function handleLogout() {
    await logoutAccount();
    const guestBidPack = loadBidPack(null);
    const guestProfile = guestBidPack ? loadProfile(null) : null;
    setState({
      screen: landingScreenFor(guestBidPack, guestProfile),
      profile: guestProfile,
      seniority: loadSeniority(null),
      user: null,
      bidPack: guestBidPack,
      parseResult: null,
      pendingProfile: null,
    });
  }

  const showSidebar = !SIDEBAR_HIDDEN_SCREENS.includes(screen);

  const screenContent = (() => {
    switch (screen) {
      case "loading":
        return (
          <div className="flex justify-center">
            <Spinner size="md" />
          </div>
        );

      case "welcome":
        return (
          <WelcomeScreen
            onStart={() => setState((s) => ({ ...s, screen: "upload" }))}
            onTrySample={handleTrySample}
          />
        );

      case "auth":
        return (
          <AuthScreen
            onAuthenticated={handleAuthenticated}
            onContinueAsGuest={handleContinueAsGuest}
          />
        );

      case "upload":
        return (
          <UploadScreen onParsed={handleParsed} currentBidPack={bidPack} onTrySample={handleTrySample} />
        );

      case "preview":
        return parseResult ? (
          <PreviewScreen
            result={parseResult}
            onConfirm={handleBidPackConfirmed}
            onUploadDifferent={() =>
              setState((s) => ({ ...s, screen: "upload", parseResult: null }))
            }
          />
        ) : null;

      case "preferences":
        return (
          <PreferencesScreen
            hasBidPack={!!bidPack}
            profile={profile}
            onGoToUpload={() => setState((s) => ({ ...s, screen: "upload" }))}
            onStartInterview={handleStartInterview}
          />
        );

      case "interview":
        return bidPack ? (
          <Interview key={interviewKey} bidPack={bidPack} onComplete={handleInterviewComplete} />
        ) : null;

      case "confirm-preferences":
        return pendingProfile && bidPack ? (
          <ConfirmPreferencesScreen
            profile={pendingProfile}
            onConfirm={handleConfirmPreferences}
            onRetakeInterview={handleStartInterview}
          />
        ) : null;

      case "results":
        return profile && bidPack ? (
          <ResultsView
            bidPack={bidPack}
            profile={profile}
            onStartOver={handleStartOver}
            onRefine={handleStartInterview}
            onUpdateProfile={handleUpdateProfile}
          />
        ) : (
          <PreferencesScreen
            hasBidPack={!!bidPack}
            profile={profile}
            onGoToUpload={() => setState((s) => ({ ...s, screen: "upload" }))}
            onStartInterview={handleStartInterview}
          />
        );

      case "strategies":
        return (
          <StrategiesScreen
            bidPack={bidPack}
            seniority={seniority}
            profile={profile}
            user={user}
            onSaveSeniority={handleSaveSeniority}
            onGoToUpload={() => setState((s) => ({ ...s, screen: "upload" }))}
            onStartInterview={handleStartInterview}
          />
        );

      case "trade-board":
        return (
          <TradeBoardScreen
            bidPack={bidPack}
            user={user}
            demoOffer={demoOffer}
            onAcceptDemoOffer={handleAcceptDemoOffer}
          />
        );

      case "inbox":
        return (
          <InboxScreen
            bidPack={bidPack}
            user={user}
            demoOffer={demoOffer}
            onGoToTradeBoard={() => setState((s) => ({ ...s, screen: "trade-board" }))}
          />
        );

      case "hotel-ratings":
        return <HotelRatingsScreen bidPack={bidPack} />;
    }
  })();

  return (
    <div className="flex min-h-full flex-col">
      {showSidebar && (
        <LeftNav
          active={screenToNavTarget(screen)}
          hasProfile={!!profile}
          hasBidPack={!!bidPack}
          user={user}
          inboxUnreadCount={inboxUnreadCount}
          onNavigate={handleNavigate}
          onSignIn={() => setState((s) => ({ ...s, screen: "auth" }))}
          onLogout={handleLogout}
          onOpenHowItWorks={() => setHowItWorksOpen(true)}
        />
      )}

      <div className={`flex flex-1 flex-col ${showSidebar ? "md:pl-60" : ""}`}>
        <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-16">
          <ScreenTransition screenKey={screen} direction={screenDirection}>
            {screenContent}
          </ScreenTransition>
        </main>
        <Footer />
      </div>

      {howItWorksOpen && (
        <Modal title="How this works" onClose={() => setHowItWorksOpen(false)}>
          <HowItWorksContent />
        </Modal>
      )}

      <ToastStack toasts={toasts} onDismiss={handleDismissToast} onClick={handleToastClick} />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-4 py-6 text-xs leading-relaxed text-ink-faint">
        Line Select is an independent, unofficial prototype built for FedEx
        pilots. It is not affiliated with, endorsed by, or connected to
        Federal Express Corporation in any way. Bid pack PDFs are uploaded to
        this app&rsquo;s own server for parsing — never to FedEx or any third
        party — which extracts pairing data, line data, reserve-line on-call
        types, and the pack&rsquo;s own summary numbers (guarantees, credit
        ranges, line counts) only; pages listing other pilots&rsquo; names,
        employee numbers, or seniority are never read, and the PDF itself
        isn&rsquo;t stored once parsing finishes. The extracted result, and
        your preferences, are then stored only on this device unless you
        create an account to save them. Account sign-in, Trade Board posts,
        and that one-time bid pack upload are the only things sent to a
        server.
      </div>
    </footer>
  );
}
