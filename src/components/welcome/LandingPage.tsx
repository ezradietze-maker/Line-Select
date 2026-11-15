"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { LogoMark } from "@/components/ui/Logo";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { landingPathFor, useAppState } from "@/lib/app-state";
import { sampleWouldReplace } from "@/lib/landing-path";
import { landingShownBefore, withLandingShown } from "@/lib/landing-return";

/**
 * The public entry point — real marketing copy (`WelcomeScreen`) for a
 * first-time or logged-out visitor with no saved state, so the app has
 * something indexable and shareable to link people to. A returning pilot
 * who already has a bid pack (and maybe a profile) is bounced straight to
 * their actual resume point instead of re-showing the pitch — `replace`,
 * not `push`, so the back button doesn't bounce them right back here.
 */
export function LandingPage() {
  const router = useRouter();
  const { ready, bidPack, profile, user, handleTrySample } = useAppState();

  // A pack this page itself loaded ("Try it with sample data") navigates on its
  // own — redirecting again here raced that navigation and dropped a returning
  // pilot straight onto Results, skipping the "same preferences as last time?"
  // prompt. Any other pack is the pilot's own, whether it was there on arrival
  // or arrived a moment later with their account (signed in on the server, but
  // this device last showed a guest), and gets them to their resume point.
  const loadingSample = useRef(false);
  // The pilot's own pack is loaded (back here with Back, or "/?welcome"): the sample would take its place, so they're asked.
  const [askingSample, setAskingSample] = useState(false);
  // "/?welcome" shows the landing page to anyone, a returning pilot included — no bounce to their resume point. So
  // does coming back to it with Back (after trying the sample, say): they asked for this page, and bouncing them on
  // made Back seem to do nothing. (Only read once state has loaded, so the server's render and the first client
  // render still match.)
  const [welcomeAsked] = useState(() => typeof window !== "undefined" && (new URLSearchParams(window.location.search).has("welcome") || landingShownBefore(window.history.state)));

  // This entry has shown the landing page now: a later Back to it is a return, not an arrival.
  useEffect(() => {
    window.history.replaceState(withLandingShown(window.history.state), "");
  }, []);

  useEffect(() => {
    if (!ready || welcomeAsked || loadingSample.current) return;
    // Signed in with no pack yet (after "Start over", say): the pitch and its "Sign in" made them look signed out.
    // Their resume point is the upload, inside the app.
    if (!bidPack) {
      if (user) router.replace("/upload");
      return;
    }
    const target = landingPathFor(bidPack, profile);
    if (target !== "/") router.replace(target);
  }, [ready, bidPack, profile, user, router, welcomeAsked]);

  // A saved-pack marker from the pre-paint script can be stale (another
  // account's pack on this browser): once state has loaded and there's no
  // pack to resume, show the landing page after all. So with one they came back for.
  useEffect(() => {
    if (ready && ((!bidPack && !user) || welcomeAsked)) document.documentElement.removeAttribute("data-returning");
  }, [ready, bidPack, user, welcomeAsked]);

  const loader = (
    <div className="flex min-h-[70vh] items-center justify-center" role="status" aria-label="Loading Line Select">
      <LogoMark className="skeleton-pulse h-16 w-16" />
    </div>
  );

  // A returning pilot on their way to their resume point: the mark, breathing gently.
  if (ready && (bidPack || user) && !welcomeAsked) return loader;

  function loadSample() {
    loadingSample.current = true;
    setAskingSample(false);
    handleTrySample();
  }

  function trySample() {
    if (sampleWouldReplace(bidPack)) setAskingSample(true);
    else loadSample();
  }

  // Everyone else gets the landing page in the server HTML, so the headline
  // paints before any JavaScript runs. A returning pilot (marked before first
  // paint by the bootstrap in lib/theme.ts) sees the mark instead while their
  // saved state loads, rather than a flash of the pitch.
  return (
    <>
      <div className="returning-only">{loader}</div>
      <div className="landing-only">
        <WelcomeScreen onStart={() => router.push("/upload")} onTrySample={trySample} appHref={user ? (bidPack ? landingPathFor(bidPack, profile) : "/upload") : null} />
      </div>
      {askingSample && bidPack && (
        <ConfirmModal
          title="Load the sample bid pack?"
          confirmLabel="Load the sample"
          alternative={{ label: profile ? "See my rankings" : "Set my preferences", onClick: () => router.push(landingPathFor(bidPack, profile)) }}
          onConfirm={loadSample}
          onCancel={() => setAskingSample(false)}
        >
          <p>
            It takes the place of your {bidPack.base} {bidPack.aircraft} {bidPack.seat} {bidPack.month} bid pack on this device. To get yours back,
            you&rsquo;d upload the PDF again.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
