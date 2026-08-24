"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { login, signUp } from "@/lib/auth";
import type { UserAccount } from "@/types/auth";

type Mode = "login" | "signup";

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const result =
      mode === "login"
        ? await login(email, password)
        : await signUp(email, password, displayName);
    setSubmitting(false);

    if (!result.ok || !result.user) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }

    onAuthenticated(result.user);
  }

  return (
    <div className="mx-auto w-full max-w-md animate-fade-in">
      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        <div className="mb-6 grid grid-cols-2 rounded-lg bg-canvas p-1">
          <TabButton active={mode === "login"} onClick={() => switchMode("login")}>
            Log in
          </TabButton>
          <TabButton active={mode === "signup"} onClick={() => switchMode("signup")}>
            Create account
          </TabButton>
        </div>

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
          <TextField
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            minLength={6}
          />
          {mode === "signup" && (
            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          )}

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={onContinueAsGuest}
          className="mt-4 w-full text-center text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          Continue as guest instead
        </button>
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-ink-faint">
        Your account is real and stored on this app&rsquo;s server so trade
        offers can be seen by other pilots &mdash; but this is still a
        prototype, running on a single dev server, not production
        infrastructure. Your bid pack and preferences stay saved locally on
        each device, as before.
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
