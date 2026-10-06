"use client";

import { ChoiceStep } from "@/components/interview/ChoiceStep";

interface CommuterStepProps {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  base: string;
  eyebrow?: string;
  /** Rendered under the options (the crash-pad follow-up and the Next button). */
  children?: React.ReactNode;
}

const PROMPT = "Do you commute to base, or live locally?";

export function CommuterStep({ value, onChange, base, eyebrow, children }: CommuterStepProps) {
  return (
    <ChoiceStep
      eyebrow={eyebrow}
      prompt={PROMPT}
      helpText="This changes what actually matters in a schedule — an early or late report, or one extra trip, can mean a hotel night or a missed flight home for a commuter."
      options={[
        { label: "I commute in", description: "I fly or drive in from somewhere else to work my trips." },
        { label: "I live locally", description: `I'm based near ${base}, no commute involved.` },
      ]}
      selected={value === true ? 0 : value === false ? 1 : null}
      onSelect={(i) => onChange(i === 0)}
    >
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`mt-4 text-sm underline decoration-dotted underline-offset-4 transition-colors ${
          value === null ? "font-medium text-accent" : "text-ink-faint hover:text-ink-muted"
        }`}
      >
        Prefer not to say
      </button>
      {children}
    </ChoiceStep>
  );
}
