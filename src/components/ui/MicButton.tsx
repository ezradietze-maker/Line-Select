"use client";

import { MicIcon } from "@/components/ui/icons";

interface MicButtonProps {
  listening: boolean;
  onClick: () => void;
  /** Compact for sitting inline next to a small control (e.g. an elaboration textarea); the default suits sitting inside a bigger text field. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * A dictation toggle — pairs with `useDictation`/`useSpeechToText`
 * (`lib/use-speech-to-text.ts`). Callers are responsible for checking
 * `supported` themselves and not rendering this at all when it's false
 * (Firefox, mainly) — there's no disabled/unsupported visual state here on
 * purpose, since a mic button that's always visible but sometimes silently
 * does nothing is worse than one that simply isn't there.
 */
export function MicButton({ listening, onClick, size = "md", className = "" }: MicButtonProps) {
  const dimension = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictating" : "Dictate with your microphone"}
      title={listening ? "Stop dictating" : "Dictate with your microphone"}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border transition-colors ${dimension} ${
        listening
          ? "border-danger/40 bg-danger-soft text-danger"
          : "border-border bg-surface text-ink-faint hover:border-border-strong hover:text-ink-muted"
      } ${className}`}
    >
      <MicIcon className={`${iconSize} ${listening ? "animate-pulse" : ""}`} />
    </button>
  );
}
