"use client";

interface SliderProps {
  value: number; // -100..100
  onChange: (value: number) => void;
  lowLabel: string;
  highLabel: string;
  centerLabel: string;
  ariaLabel: string;
}

function formatSignedValue(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

export function Slider({
  value,
  onChange,
  lowLabel,
  highLabel,
  centerLabel,
  ariaLabel,
}: SliderProps) {
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
          className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums transition-colors ${
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
          className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border-strong"
          aria-hidden
        />
        <input
          type="range"
          min={-100}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={ariaLabel}
          aria-valuetext={`${formatSignedValue(value)}, ${strength}`}
          className="line-slider relative w-full"
          style={{
            background: `linear-gradient(to right, var(--color-border-strong) 0%, var(--color-border-strong) ${fillStart}%, var(--color-brand) ${fillStart}%, var(--color-brand) ${fillEnd}%, var(--color-border-strong) ${fillEnd}%, var(--color-border-strong) 100%)`,
          }}
        />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-xs text-ink-muted">
        <span className="max-w-[40%]">{lowLabel}</span>
        <span className="text-center font-medium text-ink-faint">{strength}</span>
        <span className="max-w-[40%] text-right">{highLabel}</span>
      </div>
    </div>
  );
}
