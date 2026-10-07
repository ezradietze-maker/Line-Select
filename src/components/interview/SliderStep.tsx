"use client";

import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { Slider } from "@/components/ui/Slider";
import type { SliderQuestionConfig } from "@/lib/interview-config";

interface SliderStepProps {
  config: SliderQuestionConfig;
  value: number;
  onChange: (value: number) => void;
  /** Real, bid-pack-derived context rendered between the help text and the slider — e.g. a stat callout showing this bid pack's actual range for the thing being asked about. */
  extra?: React.ReactNode;
  eyebrow?: string;
  /**
   * A "how much does this matter" dimension (hotel factors, body clock) —
   * there's no opposite side to lean toward, so it's a one-way slider from
   * "doesn't matter" up, the same control the Preferences page uses. On a
   * two-sided slider the untouched middle read "somewhat matters" while
   * recording zero.
   */
  magnitudeOnly?: boolean;
}

const strength = (v: number) => (v === 0 ? "Doesn't matter" : v < 45 ? "Matters a little" : v < 75 ? "Matters" : "Matters a lot");

export function SliderStep({ config, value, onChange, extra, eyebrow, magnitudeOnly = false }: SliderStepProps) {
  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={config.question}
        help={
          config.helpText ??
          (magnitudeOnly ? "Slide right the more it matters — leave it at the left if it doesn’t." : "Slide toward either side, or leave it centered if it doesn’t matter to you.")
        }
      />
      <RevealControls title={config.question}>
        {extra}
        <div className="mt-10">
          {magnitudeOnly ? (
            <RangeSlider
              value={Math.max(0, value)}
              min={0}
              max={100}
              step={5}
              onChange={onChange}
              ariaLabel={config.question}
              formatValue={strength}
              minLabel={config.lowLabel}
              maxLabel={config.highLabel}
            />
          ) : (
            <Slider
              value={value}
              onChange={onChange}
              lowLabel={config.lowLabel}
              highLabel={config.highLabel}
              centerLabel={config.centerLabel}
              ariaLabel={config.question}
            />
          )}
        </div>
      </RevealControls>
    </div>
  );
}
