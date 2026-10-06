"use client";

import { useRef } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { RangeSlider } from "@/components/ui/RangeSlider";
import type { TargetSliderQuestionConfig } from "@/lib/interview-config";

interface TargetSliderStepProps {
  config: TargetSliderQuestionConfig;
  range: readonly [number, number];
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  eyebrow?: string;
}

/** At or under this many choices, every value gets its own stop instead of a slider. */
const MAX_STOPS = 12;

/**
 * A pinned number — days off, duty periods, early shows in a row — asked
 * against this pack's own real range. A small range (13–16 days off on a
 * real 767 pack, 0–4 early shows) is a row of stops, one tap each; a wide
 * one (credit hours) stays a slider. Either way the chosen number is the big
 * readout, so it's never ambiguous what will be recorded.
 */
export function TargetSliderStep({ config, range, value, onChange, eyebrow }: TargetSliderStepProps) {
  const [min, max] = range;
  const isSet = value !== undefined;
  const currentValue = value ?? Math.round((min + max) / 2 / config.step) * config.step;
  const stops = (max - min) / config.step + 1 <= MAX_STOPS ? Array.from({ length: Math.round((max - min) / config.step) + 1 }, (_, i) => min + i * config.step) : null;
  const unit = (v: number) => (v === 1 ? config.unitSingular : config.unitPlural);
  const stopRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveStop(from: number, delta: number) {
    if (!stops) return;
    const i = Math.min(stops.length - 1, Math.max(0, stops.indexOf(from) + delta));
    onChange(stops[i]);
    stopRefs.current[i]?.focus();
  }

  return (
    <div>
      <QuestionPrompt eyebrow={eyebrow} title={config.question} help={config.helpText || undefined} />

      <RevealControls title={config.question} className="mt-8">
        <div className="rounded-xl border border-hairline bg-canvas/50 p-5">
          {isSet ? (
            <>
              <div className="mb-5 text-center" aria-hidden>
                <span className="text-readout text-glow font-display text-5xl font-semibold">{config.formatValue(currentValue)}</span>
                <span className="ml-2 text-sm text-ink-muted">{unit(currentValue)}</span>
              </div>
              {stops ? (
                <div role="radiogroup" aria-label={config.question} className="flex gap-1.5">
                  {stops.map((v, i) => {
                    const selected = v === currentValue;
                    return (
                      <button
                        key={v}
                        ref={(el) => {
                          stopRefs.current[i] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${config.formatValue(v)} ${unit(v)}`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(v)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                            e.preventDefault();
                            moveStop(v, 1);
                          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                            e.preventDefault();
                            moveStop(v, -1);
                          }
                        }}
                        className={`flex-1 rounded-lg border py-3 font-mono text-base transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-panel)] ${
                          selected
                            ? "glow-soft border-accent bg-accent-soft font-semibold text-accent"
                            : "border-hairline bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
                        }`}
                      >
                        {config.formatValue(v)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <RangeSlider
                  value={currentValue}
                  min={min}
                  max={max}
                  step={config.step}
                  onChange={(v) => onChange(v)}
                  ariaLabel={config.question}
                  formatValue={(v) => `${config.formatValue(v)} ${unit(v)}`}
                  minLabel={`${config.formatValue(min)} ${config.unitPlural}`}
                  maxLabel={`${config.formatValue(max)} ${config.unitPlural}`}
                  hideValue
                />
              )}
              <p className="mt-3 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
                This pack&rsquo;s lines run {config.formatValue(min)}&ndash;{config.formatValue(max)}
              </p>
            </>
          ) : (
            <div className="py-6 text-center text-sm text-ink-faint">
              {config.noTargetFallbackText ?? "No exact number for this one — that's a fine answer too."}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onChange(isSet ? undefined : currentValue)}
          className="mt-4 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          {isSet ? "No exact number for this one" : "Set an exact number instead"}
        </button>
      </RevealControls>
    </div>
  );
}
