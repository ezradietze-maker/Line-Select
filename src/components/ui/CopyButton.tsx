"use client";

import { useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  /** Built at click time, so the copied text is always the current list. */
  getText: () => string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

/**
 * Copies to the clipboard and says so with a tick that draws itself — the
 * button confirms the action instead of the pilot wondering whether it took.
 * The confirmation is also announced to screen readers.
 */
export function CopyButton({ getText, label = "Copy", copiedLabel = "Copied", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getText());
    } catch {
      return; // Clipboard unavailable — leave the button as it was rather than claim a copy.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`press inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
        copied ? "border-good/50 bg-good-soft text-good" : "border-hairline bg-surface text-ink hover:border-accent/60 hover:text-accent"
      } ${className}`}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden>
          <path className="tick-draw" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path strokeLinecap="round" d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
        </svg>
      )}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
