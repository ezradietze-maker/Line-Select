"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { resetPasswordWithToken } from "@/lib/auth";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

/** Landing page for the link in the reset email: the token in the URL is the proof of ownership, so all that's asked for is the new password. */
function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const result = await resetPasswordWithToken(token, password);
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    // A full load, not a client navigation, so the app picks up the new session cookie from scratch.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <div className="mx-auto w-full max-w-md animate-fade-in">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        <h1 className="text-lg font-semibold text-ink">Choose a new password</h1>
        {!token ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm leading-relaxed text-ink-muted">
              This page needs the link from your reset email. Open the link in the email itself, or request a new one
              from the sign-in screen.
            </p>
            <Link href="/" className="text-sm font-medium text-brand hover:underline">
              Go to Line Select
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
            />
            <TextField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Please wait…" : "Set new password and sign in"}
            </Button>
            <p className="text-center text-xs leading-relaxed text-ink-faint">
              You&rsquo;ll be signed out everywhere else. Links expire after an hour and work once.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
