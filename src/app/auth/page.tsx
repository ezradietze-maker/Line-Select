"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthScreen, authModeFor } from "@/components/auth/AuthScreen";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { useAppState } from "@/lib/app-state";
import { landingPathFor } from "@/lib/landing-path";

export default function AuthPage() {
  // Reading the address needs a boundary of its own; the shell shows the mark here until saved state loads anyway.
  return (
    <Suspense fallback={null}>
      <AuthPageView />
    </Suspense>
  );
}

function AuthPageView() {
  const { ready, user, bidPack, profile, handleAuthenticated, handleContinueAsGuest, handleLogout } = useAppState();
  // "?view=forgot" (from the reset page's link) opens on that view rather than signing in.
  const view = useSearchParams().get("view");
  // Signed in when they got here: said so, rather than a sign-in form whose "Continue as guest" signed them out. Read
  // once, on arriving — a pilot signing in on this page carries on through the form (and its recovery code) as before.
  const [arrivedSignedIn, setArrivedSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready && arrivedSignedIn === null) setArrivedSignedIn(!!user);
  }, [ready, user, arrivedSignedIn]);

  // A view asked for by name (resetting a password) still opens.
  if (arrivedSignedIn && user && !view) {
    return (
      <div className="mx-auto w-full max-w-md">
        <Link href="/" className="mx-auto mb-5 flex w-fit items-center gap-2.5" aria-label="Line Select home">
          <LogoMark className="h-9 w-9" />
          <Wordmark className="text-lg" />
        </Link>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
          <h1 className="text-lg font-semibold text-ink">You&rsquo;re signed in</h1>
          <p className="mt-1 truncate text-sm leading-relaxed text-ink-muted" title={`${user.displayName} · ${user.email}`}>
            As {user.displayName} &middot; {user.email}
          </p>
          <Link
            href={bidPack ? landingPathFor(bidPack, profile) : "/upload"}
            className="press mt-6 flex w-full items-center justify-center rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-on-brand shadow-sm transition-all duration-150 ease-out hover:-translate-y-px hover:bg-brand-strong hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {bidPack ? "Back to your lines" : "Upload your bid pack"}
          </Link>
          {/* Then the form here, to sign in as the other pilot: the landing page was a step further from it. */}
          <button
            type="button"
            onClick={() => void handleLogout({ to: "/auth" })}
            className="mt-4 w-full text-center text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            Sign out to use another account
          </button>
        </div>
      </div>
    );
  }
  return <AuthScreen onAuthenticated={handleAuthenticated} onContinueAsGuest={handleContinueAsGuest} initialMode={authModeFor(view)} />;
}
