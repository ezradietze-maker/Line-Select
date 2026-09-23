"use client";

import { RangeSlider } from "@/components/ui/RangeSlider";
import type { TargetSliderQuestionConfig } from "@/lib/interview-config";
import { buildTarget, setTargetRole, targetParts, type TargetRole } from "@/lib/target-editing";
import type { RangeTarget } from "@/types/preferences";

const ROLE_LABELS: Record<TargetRole, { title: string; add: string }> = {
  min: { title: "Lowest I'd accept", add: "Set a lowest I'd accept" },
  ideal: { title: "Ideal", add: "Set an ideal" },
  max: { title: "Most I'd want", add: "Set a most I'd want" },
};

interface TargetEditorProps {
  config: TargetSliderQuestionConfig;
  range: readonly [number, number];
  value: number | RangeTarget | undefined;
  /** Whether a floor/ceiling band makes sense for this dimension (days off, departures) — the others (credit, consecutive early reports) are a single pinned number. */
  allowRange: boolean;
  /** `null` removes the target entirely. */
  onChange: (value: number | RangeTarget | null) => void;
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function TargetEditor({ config, range, value, allowRange, onChange }: TargetEditorProps) {
  const [min, max] = range;
  const parts = targetParts(value);
  const roles: TargetRole[] = allowRange ? ["min", "ideal", "max"] : ["ideal"];
  const anySet = roles.some((r) => parts[r] !== undefined);
  const midpoint = snap((min + max) / 2, config.step);

  function commit(next: typeof parts) {
    onChange(buildTarget(next) ?? null);
  }

  function addRole(role: TargetRole) {
    const seed = role === "min" ? (parts.ideal ?? min) : role === "max" ? (parts.ideal ?? max) : (parts.min ?? parts.max ?? midpoint);
    commit(setTargetRole(parts, role, Math.min(max, Math.max(min, seed))));
  }

  function removeRole(role: TargetRole) {
    const next = { ...parts };
    delete next[role];
    commit(next);
  }

  const format = (v: number) => `${config.formatValue(v)} ${v === 1 ? config.unitSingular : config.unitPlural}`;

  return (
    <div className="rounded-lg border border-border bg-canvas p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-ink">{config.question}</div>
        {anySet && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-xs text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink-muted"
          >
            Clear
          </button>
        )}
      </div>

      {!anySet ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ink-faint">Not set{config.noTargetFallbackText ? "" : " — your sliders above are used instead"}.</span>
          <button
            type="button"
            onClick={() => addRole("ideal")}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-ink hover:border-brand hover:text-brand"
          >
            Set a target
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {roles.map((role) =>
            parts[role] !== undefined ? (
              <div key={role}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{ROLE_LABELS[role].title}</span>
                  {allowRange && (
                    <button
                      type="button"
                      onClick={() => removeRole(role)}
                      className="text-xs text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink-muted"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <RangeSlider
                  value={parts[role] as number}
                  min={min}
                  max={max}
                  step={config.step}
                  onChange={(v) => commit(setTargetRole(parts, role, v))}
                  ariaLabel={`${config.question} — ${ROLE_LABELS[role].title}`}
                  formatValue={format}
                  minLabel={format(min)}
                  maxLabel={format(max)}
                />
              </div>
            ) : (
              <button
                key={role}
                type="button"
                onClick={() => addRole(role)}
                className="block text-sm text-brand underline decoration-dotted underline-offset-4 hover:text-brand-strong"
              >
                + {ROLE_LABELS[role].add}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
