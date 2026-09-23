"use client";

import { useMemo, useState } from "react";
import { CityChips } from "@/components/preferences/CityChips";
import { TargetEditor } from "@/components/preferences/TargetEditor";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { Slider } from "@/components/ui/Slider";
import {
  ALL_TARGET_CONFIGS,
  DEEP_SLIDERS,
  HOTEL_AMENITIES,
  HOTEL_AMENITY_WEIGHT,
  QUICK_QUESTIONS,
  deadheadQuestionFor,
  type SliderQuestionConfig,
} from "@/lib/interview-config";
import { hasEdits, type ProfileEdits } from "@/lib/profile-edits";
import { MAGNITUDE_ONLY_KEYS } from "@/lib/rank-learning";
import { getBidPackRanges, rankLayoverCitiesByFrequency } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type {
  CitySentiment,
  ExplicitTargetKey,
  PreferenceProfile,
  PreferenceWeights,
  RangeTarget,
} from "@/types/preferences";

interface PreferencesScreenProps {
  bidPack: BidPack | null;
  profile: PreferenceProfile | null;
  /** True right after a new bid pack was confirmed — shows the "same preferences as last time?" prompt instead of leaving a returning pilot with only "Retake the interview". */
  freshBidPack?: boolean;
  onGoToUpload: () => void;
  onStartInterview: () => void;
  onShowRankings?: () => void;
  onSaveEdits?: (edits: ProfileEdits) => void;
}

const SLIDER_GROUPS: { title: string; keys: (keyof PreferenceWeights)[] }[] = [
  { title: "Your schedule", keys: ["daysOff", "tripLength", "reportTime", "international", "landings", "deadheadTolerance"] },
  { title: "Pay, rest and body clock", keys: ["creditHours", "circadianHealth"] },
  { title: "On the road", keys: ["hotelQuiet", "hotelQuality"] },
  { title: "Bidding strategy", keys: ["riskTolerance", "adminEffortAppetite"] },
];

const RANGE_TARGET_KEYS = new Set<ExplicitTargetKey>(["daysOff", "departures"]);
const CIRCADIAN_TOLERANCE_RANGE: readonly [number, number] = [0, 4];

function nextSentiment(current: CitySentiment | null): CitySentiment | null {
  if (current === null) return "love";
  if (current === "love") return "avoid";
  return null;
}

export function PreferencesScreen({
  bidPack,
  profile,
  freshBidPack = false,
  onGoToUpload,
  onStartInterview,
  onShowRankings,
  onSaveEdits,
}: PreferencesScreenProps) {
  const [weightsDraft, setWeightsDraft] = useState<Partial<PreferenceWeights>>({});
  const [targetsDraft, setTargetsDraft] = useState<Partial<Record<ExplicitTargetKey, number | RangeTarget | null>>>({});
  const [citiesDraft, setCitiesDraft] = useState<Record<string, CitySentiment | null>>({});

  const edits: ProfileEdits = useMemo(
    () => ({ weights: weightsDraft, explicitTargets: targetsDraft, cityPreferences: citiesDraft }),
    [weightsDraft, targetsDraft, citiesDraft]
  );
  const dirty = profile ? hasEdits(profile, edits) : false;

  const cityCodes = useMemo(() => {
    const fromPack = bidPack ? rankLayoverCitiesByFrequency(bidPack).map((c) => c.code) : [];
    const flagged = profile ? Object.keys(profile.cityPreferences) : [];
    return [...fromPack, ...flagged.filter((c) => !fromPack.includes(c))];
  }, [bidPack, profile]);

  const ranges = useMemo(() => (bidPack ? getBidPackRanges(bidPack) : null), [bidPack]);

  if (!bidPack) {
    return (
      <EmptyState
        title="Upload a bid pack first"
        description="Preferences are scored against a real bid pack, so upload one before setting them."
        actionLabel="Upload bid pack"
        onAction={onGoToUpload}
      />
    );
  }

  if (!profile) {
    return (
      <EmptyState
        title="You haven't set your preferences yet"
        description="Answer a few questions about what you care about, and Line Select will rank every line in your bid pack against it."
        actionLabel="Start the interview"
        onAction={onStartInterview}
      />
    );
  }

  const currentProfile = profile;
  const completedDate = new Date(currentProfile.completedAt);
  const touchedKeys = new Set(
    currentProfile.discoveredFacts
      .map((f) => f.measurable)
      .filter((m) => m?.type === "explicit-weight")
      .map((m) => (m as { key: string }).key)
  );
  const hasFacts = currentProfile.discoveredFacts.length > 0;

  const sliderConfigs = new Map<string, SliderQuestionConfig>();
  for (const c of [...QUICK_QUESTIONS, ...DEEP_SLIDERS]) sliderConfigs.set(c.key, c);
  sliderConfigs.set("deadheadTolerance", deadheadQuestionFor(currentProfile.isCommuter));

  function weightOf(key: keyof PreferenceWeights): number {
    return weightsDraft[key] ?? currentProfile.weights[key];
  }

  function targetOf(key: ExplicitTargetKey): number | RangeTarget | undefined {
    if (key in targetsDraft) return targetsDraft[key] ?? undefined;
    return currentProfile.explicitTargets[key];
  }

  function sentimentOf(code: string): CitySentiment | null {
    if (code in citiesDraft) return citiesDraft[code];
    return currentProfile.cityPreferences[code] ?? null;
  }

  function cycleCity(code: string) {
    setCitiesDraft((prev) => {
      const current = code in prev ? prev[code] : (currentProfile.cityPreferences[code] ?? null);
      return { ...prev, [code]: nextSentiment(current) };
    });
  }

  function save() {
    onSaveEdits?.(edits);
    setWeightsDraft({});
    setTargetsDraft({});
    setCitiesDraft({});
  }

  function discard() {
    setWeightsDraft({});
    setTargetsDraft({});
    setCitiesDraft({});
  }

  const sentiments: Record<string, CitySentiment | null> = Object.fromEntries(cityCodes.map((c) => [c, sentimentOf(c)]));

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in pb-24">
      <div className="flex flex-col gap-4">
        <div>
          <Heading as="h1" className="text-2xl text-ink sm:text-3xl">Your preferences</Heading>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>
              Last answered {completedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
            {currentProfile.deepRoundCompleted && (
              <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Deep interview
              </span>
            )}
            {currentProfile.isCommuter !== null && (
              <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                {currentProfile.isCommuter ? "Commuter" : "Local"}
              </span>
            )}
            {currentProfile.isCommuter === true && currentProfile.hasCrashPad !== null && (
              <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium text-ink-faint">
                {currentProfile.hasCrashPad ? "Has a crash pad" : "No crash pad"}
              </span>
            )}
          </p>
        </div>
        {!freshBidPack && (
          <div className="flex gap-2">
            {onShowRankings && <Button onClick={onShowRankings}>See my rankings</Button>}
            <Button variant="secondary" onClick={onStartInterview}>Retake the interview</Button>
          </div>
        )}
      </div>

      {freshBidPack && (
        <div className="mt-6 rounded-xl border border-brand/30 bg-brand-soft/60 p-5">
          <div className="text-sm font-semibold text-ink">New bid pack loaded</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {bidPack.base} {bidPack.aircraft} {bidPack.seat} &middot; {bidPack.month} &middot; {bidPack.lines.length} lines.
            Your preferences from {completedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} carry forward &mdash;
            nothing to redo unless something&rsquo;s changed.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {onShowRankings && <Button onClick={onShowRankings}>Show my rankings</Button>}
            <Button variant="secondary" onClick={onStartInterview}>
              Something&rsquo;s changed &mdash; quick check-in
            </Button>
          </div>
        </div>
      )}

      <p className="mt-6 text-sm leading-relaxed text-ink-muted">
        Everything here is editable. Change a slider or a number and save &mdash; your rankings update right away, and
        this is what carries forward to next month.
      </p>

      {SLIDER_GROUPS.map((group) => (
        <section key={group.title} className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{group.title}</h2>
          <div className="mt-4 space-y-6">
            {group.keys.map((key) => {
              const config = sliderConfigs.get(key);
              if (!config) return null;
              const value = weightOf(key);
              const notAsked = hasFacts && !touchedKeys.has(key) && !(key in weightsDraft);
              const magnitudeOnly = MAGNITUDE_ONLY_KEYS.has(key);
              return (
                <div key={key}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <div className="text-sm font-medium text-ink">{config.question}</div>
                    {notAsked && <span className="shrink-0 text-xs text-ink-faint">Not set yet</span>}
                  </div>
                  {magnitudeOnly ? (
                    <RangeSlider
                      value={Math.max(0, value)}
                      min={0}
                      max={100}
                      step={5}
                      onChange={(v) => setWeightsDraft((d) => ({ ...d, [key]: v }))}
                      ariaLabel={config.question}
                      formatValue={(v) => (v === 0 ? "Doesn't matter" : v < 45 ? "Matters a little" : v < 75 ? "Matters" : "Matters a lot")}
                      minLabel={config.lowLabel}
                      maxLabel={config.highLabel}
                    />
                  ) : (
                    <Slider
                      value={value}
                      onChange={(v) => setWeightsDraft((d) => ({ ...d, [key]: v }))}
                      lowLabel={config.lowLabel}
                      highLabel={config.highLabel}
                      centerLabel={config.centerLabel}
                      ariaLabel={config.question}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {group.title === "On the road" && (
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium text-ink">Hotel amenities that matter to you</div>
              <div className="flex flex-wrap gap-2">
                {HOTEL_AMENITIES.map((a) => {
                  const on = weightOf(a.key) > 0;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      aria-pressed={on}
                      title={a.description}
                      onClick={() => setWeightsDraft((d) => ({ ...d, [a.key]: on ? 0 : HOTEL_AMENITY_WEIGHT }))}
                      className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        on
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      ))}

      <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Exact numbers</h2>
        <p className="mt-1 text-xs text-ink-faint">
          When you set one, it&rsquo;s used directly instead of the rough midpoint a slider implies.
        </p>
        <div className="mt-4 space-y-3">
          {ALL_TARGET_CONFIGS.map((config) => {
            const range: readonly [number, number] | null =
              config.key === "circadianTolerance"
                ? CIRCADIAN_TOLERANCE_RANGE
                : config.key === "daysOff" && ranges
                  ? ranges.daysOff
                  : config.key === "departures" && ranges
                    ? ranges.departures
                    : config.key === "creditHours" && ranges
                      ? ranges.creditHours
                      : null;
            if (!range) return null;
            return (
              <TargetEditor
                key={config.key}
                config={config}
                range={range}
                value={targetOf(config.key)}
                allowRange={RANGE_TARGET_KEYS.has(config.key)}
                onChange={(v) => setTargetsDraft((d) => ({ ...d, [config.key]: v }))}
              />
            );
          })}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Layover cities</h2>
        <div className="mt-3">
          <CityChips cities={cityCodes} sentiments={sentiments} onCycle={cycleCity} />
        </div>
      </section>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 shadow-elevated-lg backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <span className="text-sm text-ink-muted">You have unsaved changes.</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={discard}>Discard</Button>
              <Button onClick={save}>Save changes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
