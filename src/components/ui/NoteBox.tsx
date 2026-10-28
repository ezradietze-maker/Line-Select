"use client";

import { useRef } from "react";
import { MicButton } from "@/components/ui/MicButton";
import { useDictation } from "@/lib/use-speech-to-text";
import { useGrowingTextarea } from "@/lib/use-growing-textarea";

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
  const set = (next: string) => onChange(maxLength ? next.slice(0, maxLength) : next);
  const dictation = useDictation(value, set);
  useGrowingTextarea(area, value, { following: dictation.listening });
  return (
    <div className={className}>
      <div className="relative">
        <textarea
          ref={area}
          id={id}
          value={value}
          onChange={(e) => set(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={`block w-full resize-none rounded-lg border bg-canvas px-3 py-2 pr-11 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:opacity-60 ${invalid ? "border-danger" : "border-border"}`}
        />
        {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
      </div>
      {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
    </div>
  );
}
