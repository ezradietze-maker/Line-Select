"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ConfirmEmailButton } from "@/components/auth/ConfirmEmail";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAppState } from "@/lib/app-state";
import { confirmEmailLink, type ConfirmEmailOutcome } from "@/lib/auth";

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailView />
    </Suspense>
  );
}

/**
 * Where the link in a confirm email lands. The token in the address is sent to the server from here, not spent by
 * opening the link, so a mail program that fetches links to check them doesn't use it up.
 */
function ConfirmEmailView() {
  const urlToken = useSearchParams().get("token");
  const [token] = useState(urlToken);
  const { user, handleAuthenticated } = useAppState();
  const [outcome, setOutcome] = useState<ConfirmEmailOutcome | null>(null);
  const [codeSaved, setCodeSaved] = useState(false);
  const [tries, setTries] = useState(0);
  const sent = useRef(-1);

  // Out of the address bar before analytics or a page-leave event can see it.
  useEffect(() => {
    if (urlToken) window.history.replaceState(null, "", "/confirm-email");
  }, [urlToken]);

  useEffect(() => {
    // Once per try: a second run of this effect (React's development double run) must not spend the link twice.
    if (!token || sent.current === tries) return;
    sent.current = tries;
    confirmEmailLink(token).then(setOutcome);
  }, [token, tries]);

  const carryOn = (signedInUser: Parameters<typeof handleAuthenticated>[0]) => handleAuthenticated(signedInUser);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        {!token ? (
          <Result title="Confirm your email">
            <p>This page needs the link from your confirm email. Open the link in the email itself.</p>
            {user && user.emailVerified === false && <ConfirmEmailButton label="Send me a new link" className="mt-3" />}
          </Result>
        ) : !outcome ? (
          <div role="status" className="flex items-center gap-2.5 text-sm text-ink-muted">
            <Spinner size="sm" />
            <span>Confirming your email&hellip;</span>
          </div>
        ) : outcome.status === "confirmed" && outcome.signedIn !== "other-account" && outcome.signedIn !== "no" ? (
          outcome.recoveryCode && !codeSaved ? (
            <RecoveryCodePanel code={outcome.recoveryCode} reason="signup" doneLabel="Continue to Line Select" onDone={() => setCodeSaved(true)} />
          ) : (
            <Result title="Your email is confirmed" tone="good">
              <p>
                {outcome.signedIn === "now" ? "You're signed in. " : ""}
                You can trade, share what you held and count toward your seat&rsquo;s numbers now.
              </p>
              <Button className="mt-4 w-full" onClick={() => carryOn(outcome.user)}>
                Continue to Line Select
              </Button>
            </Result>
          )
        ) : outcome.status === "confirmed" && outcome.signedIn === "no" ? (
          <Result title="Your email is confirmed" tone="good">
            <p>This link was opened on a different device or browser from the one you signed up on, so you&rsquo;re not signed in here. Log in with your password to carry on.</p>
            <SignInLink />
          </Result>
        ) : outcome.status === "confirmed" ? (
          <Result title="That email is confirmed">
            <p>The link was for a different account from the one signed in here. That account&rsquo;s email is confirmed; you&rsquo;re still signed in as yourself.</p>
          </Result>
        ) : outcome.status === "used" ? (
          <Result title="This link has already been used">
            {outcome.yours ? (
              <>
                <p>Your email is already confirmed. There&rsquo;s nothing more to do.</p>
                <Link href="/" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
                  Go to Line Select
                </Link>
              </>
            ) : (
              <>
                <p>Each link works once. If it was yours, your email is confirmed: log in to carry on.</p>
                {!user && <SignInLink />}
              </>
            )}
          </Result>
        ) : outcome.status === "expired" || outcome.status === "invalid" ? (
          <Result title={outcome.status === "expired" ? "This link has expired" : "This link doesn't work"}>
            <p>
              {outcome.status === "expired"
                ? "Links work for 24 hours. Send yourself a new one."
                : "It may have been replaced by a newer one: use the link in the latest email we sent, or send yourself a new one."}
            </p>
            {user && user.emailVerified === false ? <ConfirmEmailButton label="Send me a new link" className="mt-3" /> : !user && <p className="mt-2">Log in, then send a new one from the notice at the top of the app.</p>}
            {!user && <SignInLink />}
          </Result>
        ) : (
          <Result title="Couldn't reach Line Select">
            <p>Check your connection and try again. The link still works.</p>
            <Button className="mt-4 w-full" variant="secondary" onClick={() => setTries((n) => n + 1)}>
              Try again
            </Button>
          </Result>
        )}
      </div>
    </div>
  );
}

function Result({ title, tone, children }: { title: string; tone?: "good"; children: React.ReactNode }) {
  return (
    <div>
      <h1 className={`text-lg font-semibold ${tone === "good" ? "text-good" : "text-ink"}`}>{title}</h1>
      <div className="mt-2 text-sm leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

function SignInLink() {
  return (
    <Link href="/auth" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
      Log in
    </Link>
  );
}
