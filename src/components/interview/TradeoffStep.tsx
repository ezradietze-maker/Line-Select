"use client";

import { Heading } from "@/components/ui/Heading";
import { SelectableCard } from "@/components/ui/SelectableCard";
import type { TradeoffQuestionConfig } from "@/lib/interview-config";

interface TradeoffStepProps {
  config: TradeoffQuestionConfig;
  value: number; // -1, 0, or 1
  onChange: (value: number) => void;
}

export function TradeoffStep({ config, value, onChange }: TradeoffStepProps) {
  return (
    <div>
      <Heading as="h2" className="text-xl text-ink sm:text-2xl">
        {config.prompt}
      </Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        {config.helpText ??
          "Pick whichever you’d actually choose — there’s no wrong answer."}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <SelectableCard
          label={config.optionA.label}
          description={config.optionA.description}
          selected={value === -1}
          onClick={() => onChange(-1)}
        />
        <SelectableCard
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
