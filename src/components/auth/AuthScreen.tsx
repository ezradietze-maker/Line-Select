"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { fetchEmailResetEnabled, login, requestResetEmail, resetPassword, signUp } from "@/lib/auth";
import type { UserAccount } from "@/types/auth";

type Mode = "login" | "signup" | "reset" | "forgot";

interface AuthScreenProps {
  onAuthenticated: (user: UserAccount) => void;
  onContinueAsGuest: () => void;
}

export function AuthScreen({ onAuthenticated, onContinueAsGuest }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  // After signup or a reset, the pilot must see (and confirm they saved) their recovery code before being let in.
  const [reveal, setReveal] = useState<{ user: UserAccount; code: string; reason: "signup" | "reset" } | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailResetEnabled, setEmailResetEnabled] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);

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
    setSubmitting(false);

    if (!result.ok || !result.user) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }

    if (mode !== "login" && result.recoveryCode) {
      setReveal({ user: result.user, code: result.recoveryCode, reason: mode === "reset" ? "reset" : "signup" });
      return;
    }
    onAuthenticated(result.user);
  }

  if (reveal) {
    return (
      <div className="mx-auto w-full max-w-md animate-fade-in">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
          <RecoveryCodePanel
            code={reveal.code}
            reason={reveal.reason}
            doneLabel="Continue to Line Select"
            onDone={() => onAuthenticated(reveal.user)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md animate-fade-in">
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
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-canvas p-1">
            <TabButton active={mode === "login"} onClick={() => switchMode("login")}>
              Log in
            </TabButton>
            <TabButton active={mode === "signup"} onClick={() => switchMode("signup")}>
              Create account
            </TabButton>
          </div>
        )}

        {mode === "forgot" && linkSentTo ? (
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
            placeholder="At least 6 characters"
            required
            minLength={6}
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
              minLength={6}
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
        trade offers can be seen by other pilots, and so your preferences
        follow you to a new device or browser once you&rsquo;re signed in
        &mdash; and if you forget your password, the recovery code you get
        when you sign up is your way back in. Your bid pack itself still
        stays on each device.
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
      className={`rounded-md py-2 text-sm font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}
