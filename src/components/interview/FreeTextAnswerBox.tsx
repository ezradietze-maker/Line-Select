"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MicButton } from "@/components/ui/MicButton";
import { useDictation } from "@/lib/use-speech-to-text";

interface FreeTextAnswerBoxProps {
  placeholder?: string;
  onSubmit: (text: string) => Promise<void>;
  onSkip?: () => void;
  submitLabel?: string;
}

/**
 * An open answer, in the pilot's own words. Grows with what's typed (or
 * dictated) instead of squeezing a real answer into one line; Enter sends,
 * Shift+Enter starts a new line. Keeps real busy/error handling: a network
 * failure surfaces an error and leaves the typed answer in place to retry,
 * rather than silently eating it or locking the input.
 */
export function FreeTextAnswerBox({ placeholder, onSubmit, onSkip, submitLabel = "Send" }: FreeTextAnswerBoxProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation(text, setText);
  const area = useRef<HTMLTextAreaElement>(null);

  // Grow to fit the answer, up to a sensible height, then scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
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
      <div className="relative rounded-xl border border-hairline bg-canvas/60 transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[0_0_0_4px_var(--glow-soft)]">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={2}
          placeholder={placeholder ?? "In your own words…"}
          disabled={busy}
          aria-label="Your answer"
          className="block w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
        />
        {dictation.supported && (
          <MicButton listening={dictation.listening} onClick={dictation.toggle} className="absolute right-3 top-3" />
        )}
      </div>
      <div className="mt-3 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
            >
              Skip this one
            </button>
          )}
          <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint sm:inline" aria-hidden>
            Enter to send &middot; Shift+Enter for a new line
          </span>
        </div>
        <Button type="button" onClick={handleSubmit} disabled={busy || !text.trim()} className="shrink-0 sm:px-6">
          {busy ? "Sending…" : submitLabel}
        </Button>
      </div>
      {dictation.error && <p className="mt-2 text-xs text-danger">{dictation.error}</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
