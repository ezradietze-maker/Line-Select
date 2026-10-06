"use client";

import { MotionConfig } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { LeftNav } from "@/components/nav/LeftNav";
import { NAV_ITEMS } from "@/components/nav/nav-items";
import { PhoneNav } from "@/components/nav/PhoneNav";
import { LogoMark } from "@/components/ui/Logo";
import { HowItWorksContent } from "@/components/results/HowItWorks";
import { Modal } from "@/components/ui/Modal";
import { ScreenTransition, type NavDirection } from "@/components/ui/ScreenTransition";
import { Spinner } from "@/components/ui/Spinner";
import { ToastStack } from "@/components/ui/Toast";
import { AppStateProvider, useAppState } from "@/lib/app-state";
import { navTargetForPath } from "@/lib/nav-target";

const HIDDEN_SIDEBAR_PATHS = ["/", "/auth"];

/** The linear onboarding spine — a route change between two entries here slides sideways, forward or back. */
const ROUTE_ORDER = ["/", "/auth", "/upload", "/preview", "/preferences", "/interview", "/confirm-preferences", "/results"];

/** Spine first; then two sidebar destinations move the panel stack in rail order; anything else cross-fades. */
function getDirection(from: string, to: string): NavDirection {
  const fromIndex = ROUTE_ORDER.indexOf(from);
  const toIndex = ROUTE_ORDER.indexOf(to);
  if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) return toIndex > fromIndex ? "forward" : "back";
  const fromTarget = navTargetForPath(from);
  const toTarget = navTargetForPath(to);
  if (fromTarget && toTarget && fromTarget !== toTarget) {
    const order = (t: string) => NAV_ITEMS.findIndex((item) => item.target === t);
    return order(toTarget) > order(fromTarget) ? "down" : "up";
  }
  return "fade";
}

function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    ready,
    profile,
    bidPack,
    user,
    inboxUnreadCount,
    toasts,
    bidPackSaveFailed,
    profileSaveFailed,
    handleLogout,
    handleDismissBidPackSaveWarning,
    handleDismissProfileSaveWarning,
    handleDismissToast,
    handleToastClick,
  } = useAppState();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Tracks which route the transition direction was last computed against,
  // so a route change can derive its slide direction from ROUTE_ORDER before
  // the new content ever renders — adjusted during render (React's
  // documented pattern for reacting to a prop/state change) rather than in
  // an effect, so the very first paint already carries the right direction
  // instead of flashing a stale one.
  const [renderedPath, setRenderedPath] = useState(pathname);
  const [direction, setDirection] = useState<NavDirection>("fade");
  if (pathname !== renderedPath) {
    setDirection(getDirection(renderedPath, pathname));
    setRenderedPath(pathname);
  }

  const showSidebar = !HIDDEN_SIDEBAR_PATHS.includes(pathname);
  const navProps = {
    active: navTargetForPath(pathname),
    hasProfile: !!profile,
    hasBidPack: !!bidPack,
    user,
    inboxUnreadCount,
    pack: bidPack ? { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, month: bidPack.month } : null,
    onNavigate: (target: string) => router.push(`/${target}`),
    onSignIn: () => router.push("/auth"),
    onLogout: handleLogout,
    onOpenHowItWorks: () => setHowItWorksOpen(true),
    onOpenFeedback: () => setFeedbackOpen(true),
  };

  // The sign-in page has no app frame to sketch, so it shows the mark while
  // saved state loads. The landing page renders straight away instead — its
  // headline is the first thing a new visitor sees, so it can't wait on
  // JavaScript (it handles returning pilots itself; see app/page.tsx).
  if (!ready && !showSidebar && pathname !== "/") {
    return (
      <div className="flex min-h-[80vh] flex-1 items-center justify-center" role="status" aria-label="Loading Line Select">
        <LogoMark className="skeleton-pulse h-16 w-16" detailed />
      </div>
    );
  }

  if (!ready && pathname !== "/") {
    return (
      <div className={`app-shell flex min-h-full flex-col md:flex-row ${showSidebar ? "" : "no-nav"}`}>
        {showSidebar && (
          <div className="hidden w-[var(--shell-left)] shrink-0 border-r border-sidebar-border bg-sidebar md:block">
            <div className="flex items-center gap-2.5 px-4 py-5">
              <div className="skeleton-pulse h-8 w-8 rounded-lg bg-border" aria-hidden />
              <div className="skeleton-pulse h-4 w-24 rounded bg-border" aria-hidden />
            </div>
            <div className="space-y-2 px-3 pt-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton-pulse h-9 rounded-md bg-border" aria-hidden />
              ))}
            </div>
          </div>
        )}
        <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
          <div className="w-full max-w-3xl space-y-4">
            <div className="flex items-center gap-2.5 text-sm text-ink-faint">
              <Spinner size="sm" />
              <span>Loading&hellip;</span>
            </div>
            <div className="skeleton-pulse h-8 w-56 rounded-md bg-border" aria-hidden />
            <div className="skeleton-pulse h-4 w-72 rounded bg-border" aria-hidden />
            <div className="skeleton-pulse h-32 rounded-xl bg-border" aria-hidden />
            <div className="skeleton-pulse h-32 rounded-xl bg-border" aria-hidden />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell flex min-h-full flex-col ${showSidebar ? "" : "no-nav"}`}>
      {showSidebar && (
        <>
          <LeftNav {...navProps} />
          <PhoneNav {...navProps} />
        </>
      )}

      <div className="flex flex-1 flex-col pb-[var(--shell-bottom)] transition-[padding-left] duration-300 ease-[var(--ease-emphasized)] md:pl-[var(--shell-left)]">
        {/* The landing page is full-bleed — its hero and globe run edge to edge. */}
        <main className={pathname === "/" ? "flex flex-1 flex-col" : "flex flex-1 flex-col justify-center px-4 py-10 sm:py-16"}>
          {bidPackSaveFailed && (
            <div role="alert" className="mx-auto mb-4 flex w-full max-w-3xl items-start justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
              <span>
                This bid pack is too big for your browser to keep, so it works right now but will be gone if you refresh or close this
                tab &mdash; you&rsquo;d need to upload it again. Your preferences are saved either way.
              </span>
              <button type="button" onClick={handleDismissBidPackSaveWarning} className="shrink-0 font-medium underline decoration-dotted underline-offset-4">
                Dismiss
              </button>
            </div>
          )}
          {profileSaveFailed && (
            <div role="alert" className="mx-auto mb-4 flex w-full max-w-3xl items-start justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
              <span>
                Your finished profile is too big for this browser to keep &mdash; it works right now but will be gone if
                you refresh or close this tab. Signing in saves it to your account instead, so it survives that.
              </span>
              <button type="button" onClick={handleDismissProfileSaveWarning} className="shrink-0 font-medium underline decoration-dotted underline-offset-4">
                Dismiss
              </button>
            </div>
          )}
          <ScreenTransition screenKey={pathname} direction={direction}>
            {children}
          </ScreenTransition>
        </main>
        <Footer />
      </div>

      {howItWorksOpen && (
        <Modal title="How this works" onClose={() => setHowItWorksOpen(false)}>
          <HowItWorksContent />
        </Modal>
      )}

      {feedbackOpen && (
        <Modal title="Send feedback" onClose={() => setFeedbackOpen(false)}>
          <FeedbackForm page={pathname} onClose={() => setFeedbackOpen(false)} />
        </Modal>
      )}

      <ToastStack toasts={toasts} onDismiss={handleDismissToast} onClick={handleToastClick} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppStateProvider>
      {/* A safety net under each component's own reduced-motion handling: any motion animation anywhere follows the pilot's system setting. */}
      <MotionConfig reducedMotion="user">
        <Chrome>{children}</Chrome>
      </MotionConfig>
    </AppStateProvider>
  );
}

/**
 * One quiet line on every page — the links, and the independence notice,
 * which never hides — with the full account of what happens to a pilot's
 * data one click away instead of a paragraph wall under every screen.
 */
function Footer() {
  const linkClass = "inline-block py-1.5 underline decoration-dotted underline-offset-4 hover:text-ink-muted";
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto max-w-5xl px-4 py-5 text-xs leading-relaxed text-ink-faint">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex flex-wrap gap-x-4">
            <Link href="/pricing" className={linkClass}>
              Pricing
            </Link>
            <Link href="/how-it-works" className={linkClass}>
              How this works
            </Link>
            <Link href="/terms" className={linkClass}>
              Terms
            </Link>
            <Link href="/privacy" className={linkClass}>
              Privacy
            </Link>
          </p>
          <p>
            <strong className="font-semibold text-ink-muted">Not affiliated with FedEx.</strong> An independent, unofficial
            prototype, not endorsed by or connected to Federal Express Corporation.
          </p>
        </div>
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1.5 hover:text-ink-muted">
            What happens to your data
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <p className="mt-1 max-w-3xl">
            Bid pack PDFs are uploaded to this app&rsquo;s own server for parsing — never to FedEx or any third
            party — which extracts pairing data, line data, reserve-line on-call
            types, and the pack&rsquo;s own summary numbers (guarantees, credit
            ranges, line counts) only. Pages listing other pilots&rsquo; names or
            employee numbers are never read; from the pack&rsquo;s Bid Seniority
            List, only two numbers per pilot &mdash; bid order and seniority
            &mdash; are used, to estimate your chances at each line. The PDF
            itself isn&rsquo;t stored once parsing finishes. The extracted result and
            your preferences are stored only on this device as a guest; create
            an account and your preferences follow you to a new device too,
            alongside the Trade Board, Inbox, and reporting what you held that
            an account also enables. See the{" "}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>{" "}
            for the full picture.
          </p>
        </details>
      </div>
    </footer>
  );
}
