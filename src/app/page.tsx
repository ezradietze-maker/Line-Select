"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";
import { landingPathFor, useAppState } from "@/lib/app-state";

/**
 * The public entry point — real marketing copy (`WelcomeScreen`) for a
 * first-time or logged-out visitor with no saved state, so the app has
 * something indexable and shareable to link people to. A returning pilot
 * who already has a bid pack (and maybe a profile) is bounced straight to
 * their actual resume point instead of re-showing the pitch — `replace`,
 * not `push`, so the back button doesn't bounce them right back here.
 */
export default function RootPage() {
  const router = useRouter();
  const { ready, bidPack, profile, handleTrySample } = useAppState();

  // Only a pilot who ARRIVED here already holding a bid pack gets bounced to
  // their resume point. A bid pack that appears while this page is showing
  // (e.g. "Try it with sample data") already navigates itself — redirecting
  // again here raced that navigation and dropped a returning pilot straight
  // onto Results, skipping the "same preferences as last time?" prompt.
  const hadBidPackOnArrival = useRef<boolean | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (hadBidPackOnArrival.current === null) hadBidPackOnArrival.current = !!bidPack;
    if (!hadBidPackOnArrival.current || !bidPack) return;
    const target = landingPathFor(bidPack, profile);
    if (target !== "/") router.replace(target);
  }, [ready, bidPack, profile, router]);

  // A saved-pack marker from the pre-paint script can be stale (another
  // account's pack on this browser): once state has loaded and there's no
  // pack to resume, show the landing page after all.
  useEffect(() => {
    if (ready && !bidPack) document.documentElement.removeAttribute("data-returning");
  }, [ready, bidPack]);

  const loader = (
    <div className="flex min-h-[70vh] items-center justify-center" role="status" aria-label="Loading Line Select">
      <LogoMark className="skeleton-pulse h-16 w-16" detailed />
    </div>
  );

  // A returning pilot on their way to their resume point: the mark, breathing gently.
  if (ready && bidPack) return loader;

  // Everyone else gets the landing page in the server HTML, so the headline
  // paints before any JavaScript runs. A returning pilot (marked before first
  // paint by the bootstrap in lib/theme.ts) sees the mark instead while their
  // saved state loads, rather than a flash of the pitch.
  return (
    <>
      <div className="returning-only">{loader}</div>
      <div className="landing-only">
        <WelcomeScreen onStart={() => router.push("/upload")} onTrySample={handleTrySample} />
      </div>
    </>
  );
}
