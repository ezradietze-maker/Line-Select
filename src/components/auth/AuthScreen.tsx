"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";
import { Button } from "@/components/ui/Button";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { fetchEmailResetEnabled, login, requestResetEmail, resendConfirmEmailTo, resetPassword, signUp } from "@/lib/auth";
import { AUTH_LIMITS } from "@/lib/auth-limits";
import type { UserAccount } from "@/types/auth";
import { PillHighlight } from "@/components/ui/PillHighlight";

type Mode = "login" | "signup" | "reset" | "forgot";
const MODES: readonly Mode[] = ["login", "signup", "reset", "forgot"];

/** The tab's name for each view, so a tab left on "create account" doesn't still say Sign In. */
const TAB_TITLES: Record<Mode, string> = { login: "Sign In", signup: "Create Account", forgot: "Reset Password", reset: "Reset Password" };

export function authTabTitle(mode: Mode): string {
  return `${TAB_TITLES[mode]} · Line Select`;
}

/** The view a link asks for (`/auth?view=forgot`, from the reset page), or signing in. */
export function authModeFor(view: string | null): Mode {
  return MODES.find((m) => m === view) ?? "login";
}

interface AuthScreenProps {
  onAuthenticated: (user: UserAccount) => void;
  onContinueAsGuest: () => void;
  /** The view it opens on: signing in, unless a link asked for another. */
  initialMode?: Mode;
}

export function AuthScreen({ onAuthenticated, onContinueAsGuest, initialMode = "login" }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => {
    document.title = authTabTitle(mode);
  }, [mode]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  // After signup or a reset, the pilot must see (and confirm they saved) their recovery code before being let in.
  const [reveal, setReveal] = useState<{ user: UserAccount; code: string; reason: "signup" | "reset" | "first" } | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const handedOff = useRef(false);
  const [emailResetEnabled, setEmailResetEnabled] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [checkEmailAt, setCheckEmailAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEmailResetEnabled().then((enabled) => {
      if (!cancelled) setEmailResetEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setLinkSentTo(null);
    setCheckEmailAt(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "forgot") {
      setSubmitting(true);
      const sent = await requestResetEmail(email);
      setSubmitting(false);
      if (!sent.ok) {
        setError(sent.error ?? "Something went wrong. Try again.");
      } else if (!sent.emailEnabled) {
        setEmailResetEnabled(false);
        switchMode("reset");
      } else {
        setLinkSentTo(email.trim());
      }
      return;
    }

    if ((mode === "signup" || mode === "reset") && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    // Affirmative, logged agreement at the moment of account creation — not
    // just a footer link — is what actually makes the Terms (including the
    // arbitration and liability sections) enforceable if it's ever tested.
    if (mode === "signup" && !agreedToTerms) {
      setError("You need to agree to the Terms of Service and Privacy Policy to create an account.");
      return;
    }

    setSubmitting(true);
    const result =
      mode === "login"
        ? await login(email, password)
        : mode === "reset"
          ? await resetPassword(email, recoveryCode, password)
          : await signUp(email, password, displayName);

    // Signing up with email set up: nobody is signed in until the link in the email is opened.
    if (mode === "signup" && result.ok && result.checkEmail) {
      setSubmitting(false);
      setCheckEmailAt(email.trim());
      return;
    }
    if (!result.ok || !result.user) {
      setSubmitting(false);
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }

    // A sign-in brings one only for an account that had none: its first, shown once like any other.
    if (result.recoveryCode) {
      setSubmitting(false);
      setReveal({ user: result.user, code: result.recoveryCode, reason: mode === "reset" ? "reset" : mode === "login" ? "first" : "signup" });
      return;
    }
    // Still "submitting" until the app has loaded their account and moved on: a second tap meanwhile signed in twice.
    handOff(result.user);
  }

  function handOff(user: UserAccount) {
    if (handedOff.current) return;
    handedOff.current = true;
    onAuthenticated(user);
  }

  if (reveal) {
    return (
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
          <RecoveryCodePanel
            code={reveal.code}
            reason={reveal.reason}
            doneLabel="Continue to Line Select"
            onDone={() => handOff(reveal.user)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      {/* This page has no sidebar, so the mark is the only thing saying where you are — and the way home. */}
      <Link href="/" className="mx-auto mb-5 flex w-fit items-center gap-2.5" aria-label="Line Select home">
        <LogoMark className="h-9 w-9" />
        <Wordmark className="text-lg" />
      </Link>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        {mode === "forgot" ? (
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-ink">Reset your password</h1>
            {!linkSentTo && (
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                Enter your account email and we&rsquo;ll send you a link to choose a new password.
              </p>
            )}
          </div>
        ) : mode === "reset" ? (
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-ink">Reset your password</h1>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Enter the recovery code you saved when you created your account.{" "}
              {emailResetEnabled
                ? "It proves it's you without needing your old password."
                : "There\u2019s no email reset yet, so this code is how we know it\u2019s you."}
            </p>
          </div>
        ) : (
          <>
          <h1 className="sr-only">{mode === "signup" ? "Create a Line Select account" : "Log in to Line Select"}</h1>
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-canvas p-1">
            <TabButton active={mode === "login"} onClick={() => switchMode("login")}>
              Log in
            </TabButton>
            <TabButton active={mode === "signup"} onClick={() => switchMode("signup")}>
              Create account
            </TabButton>
          </div>
          </>
        )}

        {mode === "signup" && checkEmailAt ? (
          // The same words whether or not the address already had an account: what differs is only in the email.
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-ink">Check your email to finish signing up</h2>
            <p className="rounded-lg border border-border bg-canvas px-4 py-3 text-sm leading-relaxed text-ink">
              We&rsquo;ve sent an email to <span className="break-all font-medium">{checkEmailAt}</span>. Open the link in it to
              confirm the address and sign in. It works for 24 hours, once.
            </p>
            <p className="text-sm leading-relaxed text-ink-muted">
              Nothing there after a few minutes? Check your spam folder, or choose &ldquo;Send the link again&rdquo; on the log-in
              screen. You can log in once the address is confirmed. An account that isn&rsquo;t confirmed within 7 days is removed.
            </p>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="block w-full text-center text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Back to log in
            </button>
          </div>
        ) : mode === "forgot" && linkSentTo ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-border bg-canvas px-4 py-3 text-sm leading-relaxed text-ink">
              If there&rsquo;s an account for <span className="font-medium">{linkSentTo}</span>, a reset link is on its
              way. It works for one hour and only once. Check your spam folder if it doesn&rsquo;t show up.
            </p>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="block w-full text-center text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Back to log in
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {mode === "signup" && (
            <TextField
              label="Display name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. J. Rodriguez"
              required
              maxLength={AUTH_LIMITS.displayName}
            />
          )}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            maxLength={AUTH_LIMITS.email}
          />
          {mode === "reset" && (
            <TextField
              label="Recovery code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              required
            />
          )}
          {mode !== "forgot" && (
          <TextField
            label={mode === "reset" ? "New password" : "Password"}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // Sign-in takes any length: passwords set before the 8-character rule still work.
            placeholder={mode === "login" ? undefined : "At least 8 characters"}
            required
            minLength={mode === "login" ? undefined : 8}
            maxLength={AUTH_LIMITS.password}
          />
          )}
          {(mode === "signup" || mode === "reset") && (
            <TextField
              label={mode === "reset" ? "Confirm new password" : "Confirm password"}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              maxLength={AUTH_LIMITS.password}
            />
          )}

          {mode === "signup" && (
            <label className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-muted">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border-strong text-brand focus:ring-brand"
              />
              <span>
                I agree to the{" "}
                <Link href="/terms" target="_blank" className="underline decoration-dotted underline-offset-4 hover:text-ink">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" target="_blank" className="underline decoration-dotted underline-offset-4 hover:text-ink">
                  Privacy Policy
                </Link>
                , including that this app is independent and not affiliated with FedEx, that
                nothing here is a substitute for verifying against my own official bid pack, and
                that Trade Board offers aren&rsquo;t real, binding trades.
              </span>
            </label>
          )}

          {error && <ErrorBanner>{error}</ErrorBanner>}
          {/* A refused sign-in may be an account waiting on its link: the same answer either way, so the way to get a new link is offered either way. */}
          {mode === "login" && error && emailResetEnabled && <SendLinkAgain email={email} />}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : mode === "forgot"
                  ? "Email me a reset link"
                  : mode === "reset"
                    ? "Reset password"
                    : "Create account"}
          </Button>
          {mode === "login" && (
            <button
              type="button"
              onClick={() => switchMode(emailResetEnabled ? "forgot" : "reset")}
              className="block w-full text-center text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Forgot your password?
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => switchMode("reset")}
              className="block w-full text-center text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              I have a recovery code instead
            </button>
          )}
          {mode === "reset" && emailResetEnabled && (
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="block w-full text-center text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Email me a reset link instead
            </button>
          )}
          {(mode === "reset" || mode === "forgot") && (
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="block w-full text-center text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              Back to log in
            </button>
          )}
        </form>
        )}

        <button
          type="button"
          onClick={onContinueAsGuest}
          className="mt-4 w-full text-center text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          Continue as guest instead
        </button>
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-ink-faint">
        Your account is real and stored on this app&rsquo;s own server so
        trade offers can be seen by other pilots, and so your bid pack,
        your interview (finished or partway) and your preferences follow you
        to a new device or browser once you&rsquo;re signed in &mdash; and if
        you forget your password, the recovery code we show you once your account is set up
        is your way back in.
      </p>
    </div>
  );
}

/**
 * "Send the link again" by address, under a refused sign-in. The answer is the same for every address, so it doesn't
 * say whether one has an account, nor whether it's confirmed.
 */
function SendLinkAgain({ email }: { email: string }) {
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "done"; text: string } | { kind: "failed"; text: string }>({ kind: "idle" });

  async function send() {
    if (!email.trim()) return setState({ kind: "failed", text: "Enter your email above first." });
    setState({ kind: "sending" });
    const result = await resendConfirmEmailTo(email.trim());
    setState(result.ok ? { kind: "done", text: result.message } : { kind: "failed", text: result.error });
  }

  return (
    <div className="text-sm leading-relaxed text-ink-muted">
      {state.kind !== "done" && (
        <button
          type="button"
          onClick={send}
          disabled={state.kind === "sending"}
          className="font-medium text-ink underline decoration-dotted underline-offset-4 hover:text-brand disabled:opacity-60"
        >
          {state.kind === "sending" ? "Sending\u2026" : "Send the link again"}
        </button>
      )}
      <p role="status" aria-live="polite" className={state.kind === "failed" ? "mt-1 text-danger" : "mt-1"}>
        {state.kind === "done" || state.kind === "failed" ? state.text : null}
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-md py-2 text-sm font-medium transition-colors duration-300 ${active ? "text-ink" : "text-ink-faint hover:text-ink-muted"}`}
    >
      {active && <PillHighlight group="auth-mode" className="absolute inset-0 rounded-md bg-surface shadow-sm" />}
      <span className="relative z-10">{children}</span>
    </button>
  );
}
