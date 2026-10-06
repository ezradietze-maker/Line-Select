"use client";

import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Slider } from "@/components/ui/Slider";
import type { SliderQuestionConfig } from "@/lib/interview-config";

interface SliderStepProps {
  config: SliderQuestionConfig;
  value: number;
  onChange: (value: number) => void;
  /** Real, bid-pack-derived context rendered between the help text and the slider — e.g. a stat callout showing this bid pack's actual range for the thing being asked about. */
  extra?: React.ReactNode;
  eyebrow?: string;
}

export function SliderStep({ config, value, onChange, extra, eyebrow }: SliderStepProps) {
  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={config.question}
        help={config.helpText ?? "Slide toward either side, or leave it centered if it doesn’t matter to you."}
      />
      <RevealControls title={config.question}>
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
      </RevealControls>
    </div>
  );
}
