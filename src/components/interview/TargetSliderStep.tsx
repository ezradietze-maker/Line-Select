"use client";

import { RangeSlider } from "@/components/ui/RangeSlider";
import type { TargetSliderQuestionConfig } from "@/lib/interview-config";

interface TargetSliderStepProps {
  config: TargetSliderQuestionConfig;
  range: readonly [number, number];
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

export function TargetSliderStep({
  config,
  range,
  value,
  onChange,
}: TargetSliderStepProps) {
  const [min, max] = range;
  const isSet = value !== undefined;
  const currentValue = value ?? Math.round((min + max) / 2 / config.step) * config.step;

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink sm:text-2xl">
        {config.question}
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">{config.helpText}</p>

      <div className="mt-8 rounded-lg border border-border bg-canvas p-5">
        {isSet ? (
          <RangeSlider
            value={currentValue}
            min={min}
            max={max}
            step={config.step}
            onChange={(v) => onChange(v)}
            ariaLabel={config.question}
            formatValue={(v) =>
              `${config.formatValue(v)} ${v === 1 ? config.unitSingular : config.unitPlural}`
            }
            minLabel={`${config.formatValue(min)} ${config.unitPlural}`}
            maxLabel={`${config.formatValue(max)} ${config.unitPlural}`}
          />
        ) : (
          <div className="py-2 text-center text-sm text-ink-faint">
            No exact target set &mdash; your slider answer will be used instead.
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onChange(isSet ? undefined : currentValue)}
        className="mt-4 text-sm underline decoration-dotted underline-offset-4 text-ink-faint hover:text-ink-muted"
      >
        {isSet ? "Actually, skip this one" : "Set an exact target instead"}
      </button>
    </div>
  );
}
