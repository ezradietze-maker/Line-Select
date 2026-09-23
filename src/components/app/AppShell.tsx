"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { LeftNav } from "@/components/nav/LeftNav";
import { HowItWorksContent } from "@/components/results/HowItWorks";
import { Modal } from "@/components/ui/Modal";
import { ScreenTransition } from "@/components/ui/ScreenTransition";
import { Spinner } from "@/components/ui/Spinner";
import { ToastStack } from "@/components/ui/Toast";
import { AppStateProvider, useAppState } from "@/lib/app-state";
import { navTargetForPath } from "@/lib/nav-target";

const HIDDEN_SIDEBAR_PATHS = ["/", "/auth"];

/** The linear onboarding spine — a route change between two entries here
 * gets a directional slide; a jump involving anything outside it (a
 * sidebar nav jump between results/strategies/trade-board/inbox/hotel-
 * ratings) falls back to a plain cross-fade, since there's no meaningful
 * "forward" or "back" between those. */
const ROUTE_ORDER = ["/", "/auth", "/upload", "/preview", "/preferences", "/interview", "/confirm-preferences", "/results"];

function getDirection(from: string, to: string): 1 | -1 | 0 {
  const fromIndex = ROUTE_ORDER.indexOf(from);
  const toIndex = ROUTE_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return 0;
  return toIndex > fromIndex ? 1 : -1;
}

function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, profile, bidPack, user, inboxUnreadCount, toasts, handleLogout, handleDismissToast, handleToastClick } =
    useAppState();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Tracks which route the transition direction was last computed against,
  // so a route change can derive its slide direction from ROUTE_ORDER before
  // the new content ever renders — adjusted during render (React's
  // documented pattern for reacting to a prop/state change) rather than in
  // an effect, so the very first paint already carries the right direction
  // instead of flashing a stale one.
  const [renderedPath, setRenderedPath] = useState(pathname);
  const [direction, setDirection] = useState<1 | -1 | 0>(0);
  if (pathname !== renderedPath) {
    setDirection(getDirection(renderedPath, pathname));
    setRenderedPath(pathname);
  }

  if (!ready) {
    return (
      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-16">
        <div className="flex justify-center">
          <Spinner size="md" />
        </div>
      </main>
    );
  }

  const showSidebar = !HIDDEN_SIDEBAR_PATHS.includes(pathname);

  return (
    <div className="flex min-h-full flex-col">
      {showSidebar && (
        <LeftNav
          active={navTargetForPath(pathname)}
          hasProfile={!!profile}
          hasBidPack={!!bidPack}
          user={user}
          inboxUnreadCount={inboxUnreadCount}
          onNavigate={(target) => router.push(`/${target}`)}
          onSignIn={() => router.push("/auth")}
          onLogout={handleLogout}
          onOpenHowItWorks={() => setHowItWorksOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
        />
      )}

      <div className={`flex flex-1 flex-col ${showSidebar ? "md:pl-60" : ""}`}>
        <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-16">
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
      <Chrome>{children}</Chrome>
    </AppStateProvider>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-xs leading-relaxed text-ink-faint">
        <p className="flex flex-wrap gap-x-3">
          <Link href="/pricing" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Pricing
          </Link>
          <Link href="/how-it-works" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            How this works
          </Link>
          <Link href="/terms" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Terms of Service
          </Link>
          <Link href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Privacy Policy
          </Link>
        </p>
        <p>
          <strong className="font-semibold text-ink-muted">Not affiliated with FedEx.</strong>{" "}
          Line Select is an independent, unofficial prototype built for FedEx
          pilots. It is not affiliated with, endorsed by, or connected to
          Federal Express Corporation in any way.
        </p>
        <p>
          <strong className="font-semibold text-ink-muted">What happens to your data:</strong>{" "}
          Bid pack PDFs are uploaded to this app&rsquo;s own server for parsing — never to FedEx or any third
          party — which extracts pairing data, line data, reserve-line on-call
          types, and the pack&rsquo;s own summary numbers (guarantees, credit
          ranges, line counts) only; pages listing other pilots&rsquo; names,
          employee numbers, or seniority are never read, and the PDF itself
          isn&rsquo;t stored once parsing finishes. The extracted result and
          your preferences are stored only on this device as a guest; create
          an account and your preferences follow you to a new device too,
          alongside the Trade Board, Inbox, and reporting what you held that
          an account also enables. See the{" "}
          <Link href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Privacy Policy
          </Link>{" "}
          for the full picture.
        </p>
      </div>
    </footer>
  );
}
