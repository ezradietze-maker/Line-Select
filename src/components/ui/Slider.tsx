"use client";

import { useRef } from "react";

interface SliderProps {
  value: number; // -100..100
  onChange: (value: number) => void;
  lowLabel: string;
  highLabel: string;
  centerLabel: string;
  ariaLabel: string;
  /** Renders the same fill/label visualization without a draggable input —
   * for showing a previously-answered value (e.g. a preferences summary)
   * rather than collecting one. */
  readOnly?: boolean;
}

function formatSignedValue(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * A printed tick scale under a slider's track, like an instrument's: a tick every step, taller at the ends, the middle
 * and the quarters. Inset by half the thumb so the end ticks sit under the thumb at each end.
 */
export function PrintedScale({ count }: { count: number }) {
  return (
    <div className="relative mx-2 mt-1 h-2" aria-hidden>
      {Array.from({ length: count + 1 }, (_, i) => {
        const major = i === 0 || i === count || i * 2 === count;
        const quarter = (i * 4) % count === 0;
        return (
          <span
            key={i}
            className={`absolute top-0 w-px -translate-x-1/2 ${major ? "h-2 bg-ink-faint" : quarter ? "h-1.5 bg-border-strong" : "h-1 bg-border-strong"}`}
            style={{ left: `${(i / count) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

/** Within this of center while dragging, the thumb settles on exactly "no preference" — a detent, so a pilot who means "doesn't matter" doesn't have to land on a pixel. Keyboard steps are left alone, so arrowing off center still works one step at a time. */
const CENTER_DETENT = 5;

export function Slider({
  value,
  onChange,
  lowLabel,
  highLabel,
  centerLabel,
  ariaLabel,
  readOnly = false,
}: SliderProps) {
  const dragging = useRef(false);
  const magnitude = Math.abs(value);
  const strength =
    magnitude < 10 ? centerLabel : magnitude < 45 ? "Some preference" : "Strong preference";

  // Fill outward from the center (no-preference midpoint) toward whichever
  // side the pilot drags to, rather than a left-to-right progress fill,
  // since the two ends are different options, not "more" of the same thing.
  const pct = (value + 100) / 2;
  const fillStart = Math.min(50, pct);
  const fillEnd = Math.max(50, pct);

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <span
          className={`rounded-[3px] px-2 py-0.5 font-mono text-xs font-semibold tabular-nums transition-colors ${
            magnitude < 10
              ? "bg-canvas text-ink-faint"
              : "bg-brand-soft text-brand"
          }`}
        >
          {formatSignedValue(value)}
        </span>
      </div>
      <div className="relative py-2">
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-border-strong"
          aria-hidden
        />
        {readOnly ? (
          <div
            role="img"
            aria-label={`${ariaLabel}: ${formatSignedValue(value)}, ${strength}`}
            className="h-1.5 w-full rounded-[2px]"
            style={{
              background: `linear-gradient(to right, var(--color-border-strong) 0%, var(--color-border-strong) ${fillStart}%, var(--color-brand) ${fillStart}%, var(--color-brand) ${fillEnd}%, var(--color-border-strong) ${fillEnd}%, var(--color-border-strong) 100%)`,
            }}
          />
        ) : (
          <input
            type="range"
            min={-100}
            max={100}
            step={5}
            value={value}
            onPointerDown={() => (dragging.current = true)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(dragging.current && Math.abs(v) <= CENTER_DETENT ? 0 : v);
            }}
            aria-label={ariaLabel}
            aria-valuetext={`${formatSignedValue(value)}, ${strength}`}
            className="line-slider relative w-full"
            style={{
              background: `linear-gradient(to right, var(--color-border-strong) 0%, var(--color-border-strong) ${fillStart}%, var(--color-brand) ${fillStart}%, var(--color-brand) ${fillEnd}%, var(--color-border-strong) ${fillEnd}%, var(--color-border-strong) 100%)`,
            }}
          />
        )}
      </div>
      <PrintedScale count={20} />
      {/* The side being leaned toward lights up, so the answer reads in words, not just as a thumb position. */}
      <div className="mt-2 flex items-start justify-between gap-3 text-xs">
        <span className={`max-w-[40%] transition-colors duration-200 ${value <= -10 ? "font-medium text-accent" : "text-ink-muted"}`}>{lowLabel}</span>
        <span className="text-center font-medium text-ink-faint">{strength}</span>
        <span className={`max-w-[40%] text-right transition-colors duration-200 ${value >= 10 ? "font-medium text-accent" : "text-ink-muted"}`}>
          {highLabel}
        </span>
      </div>
    </div>
  );
}
