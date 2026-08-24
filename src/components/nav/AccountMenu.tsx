"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
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
              onLogout();
            }}
            className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-canvas"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
