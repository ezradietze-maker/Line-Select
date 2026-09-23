"use client";

import { useEffect, useRef, useState } from "react";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { createRecoveryCode } from "@/lib/auth";
import type { UserAccount } from "@/types/auth";

interface AccountMenuProps {
  user: UserAccount | null;
  onSignIn: () => void;
  onLogout: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function AccountMenu({ user, onSignIn, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!user) {
    return (
      <Button variant="secondary" onClick={onSignIn} className="w-full text-sm">
        Sign in
      </Button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-full border border-sidebar-border bg-surface py-1.5 pl-1.5 pr-3 transition-colors hover:border-border-strong"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-xs font-semibold text-white">
          {initials(user.displayName)}
        </span>
        <span className="flex-1 truncate text-left text-sm font-medium text-ink">
          {user.displayName.split(" ")[0]}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-full min-w-[14rem] animate-fade-in overflow-hidden rounded-lg border border-border bg-surface shadow-elevated-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-medium text-ink">{user.displayName}</div>
            <div className="truncate text-xs text-ink-faint">{user.email}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setRecoveryOpen(true);
            }}
            className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas"
          >
            Account recovery code
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas"
          >
            Log out
          </button>
        </div>
      )}
      {recoveryOpen && <RecoveryCodeModal onClose={() => setRecoveryOpen(false)} />}
    </div>
  );
}

function RecoveryCodeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await createRecoveryCode(password);
    setSubmitting(false);
    if (!result.ok || !result.recoveryCode) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setCode(result.recoveryCode);
  }

  return (
    <Modal title="Account recovery code" onClose={onClose}>
      {code ? (
        <RecoveryCodePanel code={code} reason="new" onDone={onClose} doneLabel="Done" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            If you forget your password, a recovery code is your only way back in &mdash; there&rsquo;s no email reset.
            Making a new one replaces any code you had before. Confirm your password to continue.
          </p>
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={submitting || !password} className="w-full">
            {submitting ? "Please wait…" : "Create a new recovery code"}
          </Button>
        </form>
      )}
    </Modal>
  );
}
