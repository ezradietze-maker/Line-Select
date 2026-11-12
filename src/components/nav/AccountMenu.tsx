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

/**
 * The account area's place, held while the session check runs: a public page draws its nav at once, and "Sign in"
 * there flashed up for a pilot who was already signed in.
 */
export function AccountPlaceholder() {
  return <div aria-hidden data-account-placeholder className="skeleton-pulse h-10 w-full rounded-md bg-border" />;
}

export function AccountMenu({ user, onSignIn, onLogout }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Closed, with the keyboard back on the button that opened it rather than dropped at the top of the page. */
  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    // A menu opens onto its first item; the arrows go from there.
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
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
      <Button variant="secondary" onClick={onSignIn} className="w-full text-sm rail-collapsed:px-0" title="Sign in">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="hidden h-[18px] w-[18px] rail-collapsed:block" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H3" />
        </svg>
        <span className="rail-collapsed:sr-only">Sign in</span>
      </Button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.displayName}
        className="flex w-full items-center gap-2.5 rounded-full border border-sidebar-border bg-surface py-1.5 pl-1.5 pr-3 transition-colors hover:border-border-strong rail-collapsed:justify-center rail-collapsed:px-1.5"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-xs font-semibold text-on-brand">
          {initials(user.displayName)}
        </span>
        <span className="flex-1 truncate text-left text-sm font-medium text-ink rail-collapsed:sr-only">
          {user.displayName.split(" ")[0]}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform rail-collapsed:hidden ${open ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full min-w-[14rem] animate-fade-in overflow-hidden rounded-lg border border-border bg-surface shadow-elevated-lg">
          {/* Who's signed in sits above the menu, not in it: a menu holds only its items. */}
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-medium text-ink">{user.displayName}</div>
            <div className="truncate text-xs text-ink-faint">{user.email}</div>
          </div>
          {/* A real menu: Up and Down move between the items, Home and End go to the ends, Tab leaves and closes it. */}
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                // From the button, so the Tab itself goes on to whatever comes after (or before) the menu.
                buttonRef.current?.focus();
                setOpen(false);
                return;
              }
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
              const at = items.indexOf(document.activeElement as HTMLElement);
              const next =
                e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
              if (next === null) return;
              e.preventDefault();
              items[next]?.focus();
            }}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                setRecoveryOpen(true);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas focus-visible:bg-canvas"
            >
              Account recovery code
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                onLogout();
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas focus-visible:bg-canvas"
            >
              Log out
            </button>
          </div>
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
    // Once the request is sent the old code may already be gone, and a new one is shown only once: from then on only
    // the confirmed button closes the dialog, never a stray Escape or tap outside.
    <Modal title="Account recovery code" onClose={onClose} locked={submitting || !!code}>
      {code ? (
        <RecoveryCodePanel code={code} reason="new" onDone={onClose} doneLabel="Done" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            If you forget your password, a recovery code gets you back in without needing your email.
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
