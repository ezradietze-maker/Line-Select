"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The list toolbar's ⋯: what the pilot sets once and rarely touches — tiers, the colour key, how the index is scored,
 * how swaps behave, keyboard shortcuts — in one small panel under the button. Closes on a click outside it or Escape.
 */
export function ListMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More list settings: tiers, key, scoring, swaps"
        onClick={() => setOpen((v) => !v)}
        data-list-menu-button
        className={`flex min-h-10 items-center rounded-md border px-3 text-lg leading-none transition-colors ${open ? "border-accent text-ink" : "border-field-edge bg-canvas/50 text-ink-muted hover:border-accent hover:text-ink"}`}
      >
        <span aria-hidden>&middot;&middot;&middot;</span>
      </button>
      {open && (
        <div
          role="group"
          aria-label="List settings"
          data-list-menu
          // Along the foot on a phone, over the tab bar (the button can wrap to either end of its row there); under the
          // button, from its right edge, on a wider screen.
          className="animate-fade-in fixed inset-x-3 bottom-[calc(var(--shell-bottom,0px)+0.75rem)] z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface p-3 text-sm shadow-elevated-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1.5 sm:max-h-none sm:w-[22rem] sm:overflow-visible"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One part of the menu, under a small heading. */
export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-hairline pt-3 first:mt-0 first:border-0 first:pt-0">
      <p className="text-2xs font-medium text-ink-faint">{title}</p>
      <div className="mt-1.5 space-y-2">{children}</div>
    </div>
  );
}

/** A switch in the menu: a checkbox with what it does. */
export function MenuCheck({ checked, onChange, label, hint, data }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: string; data?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink" {...(data ? { [`data-${data}`]: true } : {})}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** An action in the menu. */
export function MenuAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block text-left text-sm font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </button>
  );
}
