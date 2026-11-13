"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmEmailButton } from "@/components/auth/ConfirmEmail";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { CONFIRM_SIGN_IN_KEY, EMAIL_CONFIRMED_KEY, useAppState } from "@/lib/app-state";
import { confirmEmailLink, type ConfirmEmailOutcome } from "@/lib/auth";
import { AUTH_LIMITS } from "@/lib/auth-limits";

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailView />
    </Suspense>
  );
}

/**
 * Where the link in a confirm email lands. The token in the address is sent to the server from here, not spent by
 * opening the link, so a mail program that fetches links to check them doesn't use it up. It asks for the account's
 * password first, or "This wasn't me": confirming says the account is the address owner's, so it takes the password as
 * well as the inbox.
 */
function ConfirmEmailView() {
  const urlToken = useSearchParams().get("token");
  const [token] = useState(urlToken);
  const { user, handleAuthenticated } = useAppState();
  const router = useRouter();
  /** Where "Continue" goes once the account has what this device's guest had; null until it does. */
  const [landing, setLanding] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ConfirmEmailOutcome | null>(null);
  const [asking, setAsking] = useState<{ email: string } | null>(null);
  const [password, setPassword] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    confirmEmailLink(token).then((result) => {
      if (result.status === "needs-password") setAsking({ email: result.email });
      else setOutcome(result);
    });
  }, [token, tries]);

  // Confirmed: the account takes over what this device's guest had straight away, not when "Continue" is pressed, so
  // a reload or a closed tab can't leave the pack and interview behind. Other tabs hear of the confirm and drop their notice.
  const confirmedUser = outcome?.status === "confirmed" && outcome.signedIn !== "other-account" ? outcome : null;
  const adopted = useRef(false);
  useEffect(() => {
    if (!confirmedUser || adopted.current) return;
    adopted.current = true;
    try {
      window.localStorage.setItem(EMAIL_CONFIRMED_KEY, `${confirmedUser.user.id}:${Date.now()}`);
      if (confirmedUser.signedIn === "now") window.localStorage.setItem(CONFIRM_SIGN_IN_KEY, confirmedUser.user.id);
    } catch {
      // Private mode: the step below still runs; only a reload in the middle of it wouldn't finish it.
    }
    void handleAuthenticated(confirmedUser.user, { stay: true }).then(setLanding);
  }, [confirmedUser, handleAuthenticated]);

  async function send(choice: { password?: string; notMe?: boolean }) {
    if (!token) return;
    setBusy(true);
    setAskError(null);
    const result = await confirmEmailLink(token, choice);
    setBusy(false);
    if (result.status === "wrong-password") return setAskError("That password doesn't match this account.");
    if (result.status === "limited") return setAskError(choice.notMe ? "We've sent a few emails to this address already. Try again in an hour." : "Too many tries. Wait 15 minutes, then try again.");
    if (result.status === "unreachable") return setAskError("Couldn't reach Line Select. Check your connection and try again.");
    setAsking(null);
    setOutcome(result);
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (password) void send({ password });
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        {!token ? (
          <Result title="Confirm your email">
            <p>This page needs the link from your confirm email. Open the link in the email itself.</p>
            {user && user.emailVerified === false && <ConfirmEmailButton label="Send me a new link" className="mt-3" />}
          </Result>
        ) : asking ? (
          <div>
            <h1 className="text-lg font-semibold text-ink">Confirm your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Enter the password for the Line Select account at <span className="break-all font-medium text-ink">{asking.email}</span>: the one you
              chose when you signed up. Confirming says the account is yours, so it takes the password as well as this link.
            </p>
            <form onSubmit={submitPassword} className="mt-4 space-y-4" noValidate>
              {/* The account's address, for a password manager to know which saved password this is. */}
              <input type="email" name="username" autoComplete="username" value={asking.email} readOnly hidden />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                // The only thing to do here: the cursor is in it, not a dozen Tabs away.
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={AUTH_LIMITS.password}
              />
              {askError && <ErrorBanner>{askError}</ErrorBanner>}
              <Button type="submit" disabled={busy || !password} className="w-full">
                {busy ? "Please wait…" : "Confirm and sign in"}
              </Button>
            </form>
            <div className="mt-5 border-t border-hairline pt-4 text-sm leading-relaxed text-ink-muted">
              <p>
                Didn&rsquo;t sign up for Line Select? Someone may have used your address. We&rsquo;ll email you a link that lets you set the
                password and makes the account yours, and nothing is confirmed for them.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send({ notMe: true })}
                className="mt-2 font-medium text-ink underline decoration-dotted underline-offset-4 hover:text-brand disabled:opacity-60"
              >
                This wasn&rsquo;t me
              </button>
            </div>
          </div>
        ) : !outcome ? (
          <div role="status" className="flex items-center gap-2.5 text-sm text-ink-muted">
            <Spinner size="sm" />
            <span>Confirming your email&hellip;</span>
          </div>
        ) : outcome.status === "confirmed" && outcome.signedIn !== "other-account" ? (
          outcome.recoveryCode && !codeSaved ? (
            <RecoveryCodePanel code={outcome.recoveryCode} reason="signup" doneLabel="Continue to Line Select" onDone={() => setCodeSaved(true)} />
          ) : (
            <Result title="Your email is confirmed" tone="good">
              <p>
                {outcome.signedIn === "now" ? "You're signed in. " : ""}
                You can trade, share what you held and count toward your seat&rsquo;s numbers now.
              </p>
              <Button className="mt-4 w-full" disabled={!landing} onClick={() => landing && router.push(landing)}>
                {landing ? "Continue to Line Select" : "Getting your account ready\u2026"}
              </Button>
            </Result>
          )
        ) : outcome.status === "confirmed" ? (
          <Result title="That email is confirmed">
            <p>The link was for a different account from the one signed in here. That account&rsquo;s email is confirmed; you&rsquo;re still signed in as yourself.</p>
          </Result>
        ) : outcome.status === "not-me" ? (
          <Result title="Check your email">
            <p>
              We&rsquo;ve sent a link to this address. Open it within the hour and choose a password: the account becomes yours, and anyone
              else using it is signed out. If you don&rsquo;t want a Line Select account, you can ignore it.
            </p>
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
                <p>Each link works once. If it was yours and you confirmed it, log in to carry on.</p>
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
            {user && user.emailVerified === false ? (
              <ConfirmEmailButton label="Send me a new link" className="mt-3" />
            ) : (
              !user && (
                <>
                  <p className="mt-2">On the log-in page, enter your email and choose &ldquo;Send the link again&rdquo;.</p>
                  <SignInLink />
                </>
              )
            )}
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
