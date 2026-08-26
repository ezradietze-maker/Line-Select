"use client";

import { Slider } from "@/components/ui/Slider";
import type { SliderQuestionConfig } from "@/lib/interview-config";

interface SliderStepProps {
  config: SliderQuestionConfig;
  value: number;
  onChange: (value: number) => void;
  /** Real, bid-pack-derived context rendered between the help text and the slider — e.g. a stat callout showing this bid pack's actual range for the thing being asked about. */
  extra?: React.ReactNode;
}

export function SliderStep({ config, value, onChange, extra }: SliderStepProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink sm:text-2xl">
        {config.question}
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        {config.helpText ?? "Slide toward either side, or leave it centered if it doesn’t matter to you."}
      </p>
      {extra}
      <div className="mt-10">
        <Slider
          value={value}
          onChange={onChange}
          lowLabel={config.lowLabel}
          highLabel={config.highLabel}
          centerLabel={config.centerLabel}
          ariaLabel={config.question}
        />
      </div>
    </div>
  );
}
