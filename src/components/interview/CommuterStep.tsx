"use client";

import { ChoiceStep } from "@/components/interview/ChoiceStep";
import { airportCityName } from "@/lib/airport-city-names";

interface CommuterStepProps {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  /** They chose "Prefer not to say" — an answer, unlike not having answered yet. */
  declined?: boolean;
  base: string;
  eyebrow?: string;
  /** Rendered under the options (the crash-pad follow-up and the Next button). */
  children?: React.ReactNode;
}

/** The question, with the domicile by its city; the transcript the brain reads says the same. */
export const commuterPrompt = (base: string) => `Do you commute to ${airportCityName(base) ?? "the domicile"}, or live locally?`;

export function CommuterStep({ value, onChange, declined = false, base, eyebrow, children }: CommuterStepProps) {
  return (
    <ChoiceStep
      eyebrow={eyebrow}
      prompt={commuterPrompt(base)}
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
        aria-pressed={declined}
        className={`mt-4 text-sm underline decoration-dotted underline-offset-4 transition-colors ${
          declined ? "font-medium text-accent" : "text-ink-faint hover:text-ink-muted"
        }`}
      >
        Prefer not to say
      </button>
      {children}
    </ChoiceStep>
  );
}
