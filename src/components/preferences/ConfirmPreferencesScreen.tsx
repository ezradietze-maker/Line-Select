"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { Slider } from "@/components/ui/Slider";
import {
  ALL_TARGET_CONFIGS,
  DEEP_SLIDERS,
  HOTEL_AMENITIES,
  QUICK_QUESTIONS,
  deadheadQuestionFor,
} from "@/lib/interview-config";
import { summarizePreferencesSentence } from "@/lib/preference-summary";
import type { PreferenceProfile, PreferenceWeights } from "@/types/preferences";

interface ConfirmPreferencesScreenProps {
  profile: PreferenceProfile;
  onConfirm: (weights: PreferenceWeights) => void;
  onRetakeInterview: () => void;
}

/**
 * Shown right after the interview finishes, before any ranking is
 * generated — a plain-English readout of what the app is about to weight
 * heavily, with every slider left live so a pilot can nudge something
 * that's off without re-answering the whole interview. Nothing here is
 * final until "Show my rankings" is pressed.
 */
export function ConfirmPreferencesScreen({
  profile,
  onConfirm,
  onRetakeInterview,
}: ConfirmPreferencesScreenProps) {
  const [weights, setWeights] = useState<PreferenceWeights>(profile.weights);

  const sliderConfigs = [
    ...QUICK_QUESTIONS,
    ...DEEP_SLIDERS.map((s) =>
      s.key === "deadheadTolerance" ? deadheadQuestionFor(profile.isCommuter) : s
    ),
  ];
  const selectedAmenities = HOTEL_AMENITIES.filter((a) => weights[a.key] > 0);

  const sentence = summarizePreferencesSentence(weights, profile.explicitTargets);
  const pinnedTargets = ALL_TARGET_CONFIGS.filter(
    (t) => profile.explicitTargets[t.key] !== undefined
  );
  const lovedCities = Object.entries(profile.cityPreferences)
    .filter(([, sentiment]) => sentiment === "love")
    .map(([code]) => code);
  const avoidedCities = Object.entries(profile.cityPreferences)
    .filter(([, sentiment]) => sentiment === "avoid")
    .map(([code]) => code);

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border-strong px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
          Here&rsquo;s what we heard
        </span>
        {profile.isCommuter !== null && (
          <span className="rounded-full bg-brand-soft px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-brand">
            {profile.isCommuter ? "Commuter" : "Local"}
          </span>
        )}
        {profile.isCommuter === true && profile.hasCrashPad !== null && (
          <span className="rounded-full border border-border-strong px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            {profile.hasCrashPad ? "Has a crash pad" : "No crash pad"}
          </span>
        )}
      </div>
      <Heading as="h1" className="mt-4 text-2xl leading-snug text-ink sm:text-3xl">
        {sentence}
      </Heading>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        This is what will drive your ranking. Nudge anything that looks off before we score
        your lines, or redo the interview from scratch if you&rsquo;d rather start over.
      </p>

      <div className="mt-6 space-y-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
        {sliderConfigs.map((config) => (
          <div key={config.key}>
            <div className="text-sm font-medium text-ink">{config.question}</div>
            <div className="mt-2">
              <Slider
                value={weights[config.key]}
                onChange={(v) => setWeights((w) => ({ ...w, [config.key]: v }))}
                lowLabel={config.lowLabel}
                highLabel={config.highLabel}
                centerLabel={config.centerLabel}
                ariaLabel={config.question}
              />
            </div>
          </div>
        ))}
      </div>

      {pinnedTargets.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Exact targets you pinned
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Exact numbers you pinned &mdash; redo the interview to change these.
          </p>
          <div className="mt-3 space-y-2">
            {pinnedTargets.map((t) => (
              <div key={t.key} className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">{t.question}</span>
                <span className="font-mono font-semibold text-ink">
                  {t.formatValue(profile.explicitTargets[t.key]!)} {t.unitPlural}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedAmenities.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Hotel amenities that matter to you
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedAmenities.map((a) => (
              <span
                key={a.key}
                className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-xs font-medium text-brand"
              >
                {a.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(lovedCities.length > 0 || avoidedCities.length > 0) && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Cities you flagged
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {lovedCities.map((code) => (
              <span
                key={code}
                className="rounded-full border border-good/30 bg-good-soft px-3 py-1 text-xs font-medium text-good"
              >
                &hearts; {code}
              </span>
            ))}
            {avoidedCities.map((code) => (
              <span
                key={code}
                className="rounded-full border border-danger/30 bg-danger-soft px-3 py-1 text-xs font-medium text-danger"
              >
                &times; {code}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onRetakeInterview}>
          Redo the full interview
        </Button>
        <Button onClick={() => onConfirm(weights)} className="sm:px-8">
          Looks right &mdash; show my rankings
        </Button>
      </div>
    </div>
  );
}
