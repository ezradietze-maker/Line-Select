"use client";

import { useRef } from "react";
import { MicButton } from "@/components/ui/MicButton";
import { SHOW_LEFT_UNDER } from "@/lib/brain/answer-limits";
import { useDictation } from "@/lib/use-speech-to-text";
import { useGrowingTextarea } from "@/lib/use-growing-textarea";
import { PASTE_CUT_NOTICE, usePasteLimit } from "@/lib/use-paste-limit";
import { useSettledSaying } from "@/lib/use-settled-saying";

interface NoteBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** For a box without a visible label. */
  ariaLabel?: string;
  /** For a box a visible <label> points at. */
  id?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Lines it starts at; it grows from there. */
  rows?: number;
  /** Marks it as needing a fix (a form error under it). */
  invalid?: boolean;
  className?: string;
}

/**
 * A note in the pilot's own words — "What decided it?", "Anything else?", a city's reasons: two lines to start, growing
 * with what's typed or dictated (see `useGrowingTextarea`), with the microphone in its corner wherever the browser can
 * dictate.
 */
export function NoteBox({ value, onChange, placeholder, ariaLabel, id, maxLength, disabled, rows = 2, invalid, className = "" }: NoteBoxProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const paste = usePasteLimit(maxLength);
  const set = (next: string) => {
    paste.changed(next);
    onChange(maxLength ? next.slice(0, maxLength) : next);
  };
  const dictation = useDictation(value, set, { maxLength });
  const left = maxLength === undefined ? null : maxLength - value.length;
  const nearlyFull = left !== null && left < SHOW_LEFT_UNDER;
  // Said once typing pauses: read out on every key, the count talked over each letter typed.
  const leftSaid = useSettledSaying(nearlyFull ? `${left.toLocaleString()} characters left` : "");
  useGrowingTextarea(area, value, { following: dictation.listening });
  return (
    <div className={className}>
      <div className="relative">
        <textarea
          ref={area}
          id={id}
          value={value}
          onChange={(e) => set(e.target.value)}
          onPaste={paste.onPaste}
          rows={rows}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={`block w-full resize-none rounded-[4px] border bg-panel px-3 py-2 pr-11 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-[var(--color-focus-ring)] focus:outline-none disabled:opacity-60 ${invalid ? "border-danger" : "border-field-edge"}`}
        />
        {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
      </div>
      {/* As the story box does: how much room is left, once it's nearly full. */}
      {nearlyFull && (
        <p className="mt-1 text-right font-mono text-2xs text-ink-faint">
          {left.toLocaleString()} characters left
        </p>
      )}
      <span role="status" className="sr-only">
        {leftSaid}
      </span>
      {paste.cut && (
        <p className="mt-1 text-xs text-warn" role="status">
          {PASTE_CUT_NOTICE}
        </p>
      )}
      {dictation.error && <p role="alert" className="mt-1 text-xs text-danger">{dictation.error}</p>}
    </div>
  );
}
