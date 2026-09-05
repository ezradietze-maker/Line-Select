"use client";

import { Heading } from "@/components/ui/Heading";
import { SelectableCard } from "@/components/ui/SelectableCard";

interface CommuterStepProps {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  base: string;
}

export function CommuterStep({ value, onChange, base }: CommuterStepProps) {
  return (
    <div>
      <Heading as="h2" className="text-xl text-ink sm:text-2xl">
        Do you commute to base, or live locally?
      </Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        This changes what actually matters in a schedule &mdash; an early or
        late report, or one extra trip, can mean a hotel night or a missed
        flight home for a commuter, even if you wouldn&rsquo;t otherwise weight
        it heavily.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <SelectableCard
          label="I commute in"
          description="I fly or drive in from somewhere else to work my trips."
          selected={value === true}
          onClick={() => onChange(true)}
        />
        <SelectableCard
          label="I live locally"
          description={`I'm based near ${base}, no commute involved.`}
          selected={value === false}
          onClick={() => onChange(false)}
        />
      </div>

      <button
        type="button"
        onClick={() => onChange(null)}
        className={`mt-4 text-sm underline decoration-dotted underline-offset-4 transition-colors ${
          value === null ? "text-brand font-medium" : "text-ink-faint hover:text-ink-muted"
        }`}
      >
        Prefer not to say
      </button>
    </div>
  );
}
