"use client";

import { useState } from "react";

interface FreeTextAnswerBoxProps {
  placeholder?: string;
  onSubmit: (text: string) => Promise<void>;
  onSkip?: () => void;
  submitLabel?: string;
}

/**
 * A free-text input with real busy/error handling — extracted from
 * `AdaptiveFollowUp.tsx`'s own pattern (that component is retired along
 * with the legacy static interview it was part of; this is the reusable
 * half of it) so the adaptive interview's `free-text` question kind gets
 * the same robustness: a network failure surfaces a real error and leaves
 * the pilot's typed answer in place to retry, rather than silently eating
 * it or locking the input.
 */
export function FreeTextAnswerBox({ placeholder, onSubmit, onSkip, submitLabel = "Send" }: FreeTextAnswerBoxProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch {
      setError("Couldn't send that — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 rounded-md border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {busy ? "Sending…" : submitLabel}
        </button>
      </div>
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="mt-2 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          Skip this one
        </button>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
