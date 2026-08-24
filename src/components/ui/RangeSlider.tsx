"use client";

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  formatValue: (value: number) => string;
  minLabel: string;
  maxLabel: string;
}

export function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
  formatValue,
  minLabel,
  maxLabel,
}: RangeSliderProps) {
  const pct = max - min < 1e-9 ? 50 : ((value - min) / (max - min)) * 100;

  return (
    <div>
      <div className="mb-2 flex items-center justify-center">
        <span className="rounded-full bg-brand-soft px-3 py-1 font-mono text-base font-semibold tabular-nums text-brand">
          {formatValue(value)}
        </span>
      </div>
      <div className="relative py-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={ariaLabel}
          aria-valuetext={formatValue(value)}
          className="line-slider relative w-full"
          style={{
            background: `linear-gradient(to right, var(--color-brand) 0%, var(--color-brand) ${pct}%, var(--color-border-strong) ${pct}%, var(--color-border-strong) 100%)`,
          }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
