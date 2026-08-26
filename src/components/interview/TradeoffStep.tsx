"use client";

import type { TradeoffQuestionConfig } from "@/lib/interview-config";

interface TradeoffStepProps {
  config: TradeoffQuestionConfig;
  value: number; // -1, 0, or 1
  onChange: (value: number) => void;
}

export function TradeoffStep({ config, value, onChange }: TradeoffStepProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink sm:text-2xl">
        {config.prompt}
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        {config.helpText ??
          "Pick whichever you’d actually choose — there’s no wrong answer."}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <OptionCard
          label={config.optionA.label}
          description={config.optionA.description}
          selected={value === -1}
          onClick={() => onChange(-1)}
        />
        <OptionCard
          label={config.optionB.label}
          description={config.optionB.description}
          selected={value === 1}
          onClick={() => onChange(1)}
        />
      </div>

      <button
        type="button"
        onClick={() => onChange(0)}
        className={`mt-4 text-sm underline decoration-dotted underline-offset-4 transition-colors ${
          value === 0 ? "text-brand font-medium" : "text-ink-faint hover:text-ink-muted"
        }`}
      >
        Honestly, no strong preference either way
      </button>
    </div>
  );
}

function OptionCard({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative rounded-lg border-2 p-5 text-left transition-all ${
        selected
          ? "border-brand bg-brand-soft ring-2 ring-brand/25 ring-offset-2 ring-offset-canvas"
          : "border-border bg-surface hover:border-border-strong hover:bg-canvas"
      }`}
    >
      <div
        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
          selected
            ? "border-brand bg-brand text-white"
            : "border-border-strong bg-surface text-transparent"
        }`}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <div className="pr-6 text-sm font-semibold text-ink">{label}</div>
      <div className="mt-1 pr-6 text-sm text-ink-muted">{description}</div>
    </button>
  );
}
