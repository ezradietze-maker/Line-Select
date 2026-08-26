"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ProgressDots } from "@/components/ui/ProgressDots";
import { CityPreferenceStep } from "@/components/interview/CityPreferenceStep";
import { CommuterStep } from "@/components/interview/CommuterStep";
import { HotelAmenitiesStep } from "@/components/interview/HotelAmenitiesStep";
import { SliderStep } from "@/components/interview/SliderStep";
import { TargetSliderStep } from "@/components/interview/TargetSliderStep";
import { TradeoffStep } from "@/components/interview/TradeoffStep";
import {
  DEEP_STEPS,
  HOTEL_AMENITY_WEIGHT,
  QUICK_STEPS,
  TARGET_SLIDERS,
  TRADEOFF_QUESTIONS,
  deadheadQuestionFor,
  formatHoursValue,
} from "@/lib/interview-config";
import { buildProfile, cycleCitySentiment, emptyWeights } from "@/lib/preference-logic";
import { getBidPackRanges, rankLayoverCitiesByFrequency } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type {
  CitySentiment,
  ExplicitTargetKey,
  PreferenceProfile,
  QuickQuestionKey,
  TradeoffAnswer,
} from "@/types/preferences";

type Phase =
  | "commuter"
  | "quick"
  | "deep-offer"
  | "deep-sliders"
  | "deep-targets"
  | "deep-tradeoffs";

interface InterviewProps {
  bidPack: BidPack;
  onComplete: (profile: PreferenceProfile) => void;
}

const MAX_CITY_CHOICES = 12;

function formatHHMM(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

export function Interview({ bidPack, onComplete }: InterviewProps) {
  const ranges = useMemo(() => getBidPackRanges(bidPack), [bidPack]);
  const topCities = useMemo(
    () =>
      rankLayoverCitiesByFrequency(bidPack)
        .slice(0, MAX_CITY_CHOICES)
        .map((c) => c.code),
    [bidPack]
  );

  /**
   * Real numbers pulled straight from this pilot's own bid pack, shown as
   * stat callouts on the plain preference sliders so every question is
   * grounded in this specific bid pack rather than an abstract dial —
   * estimated lines are excluded since their trip shape is a guess, not a
   * verified fact worth quoting back to the pilot.
   */
  const tripLengthStats = useMemo(() => {
    const days = bidPack.lines
      .filter((l) => !l.estimated)
      .flatMap((l) => l.trips.map((t) => t.days));
    return days.length > 0 ? { min: Math.min(...days), max: Math.max(...days) } : null;
  }, [bidPack]);

  const reportTimeStats = useMemo(() => {
    const times = bidPack.lines
      .filter((l) => !l.estimated)
      .flatMap((l) => l.trips)
      .flatMap((t) => (t.schedule[0] ? [t.schedule[0].reportTimeLocal] : []));
    if (times.length === 0) return null;
    const sorted = [...times].sort();
    return { earliest: sorted[0], latest: sorted[sorted.length - 1] };
  }, [bidPack]);

  const deadheadStats = useMemo(() => {
    const trips = bidPack.lines.filter((l) => !l.estimated).flatMap((l) => l.trips);
    if (trips.length === 0) return null;
    return Math.round((trips.filter((t) => t.deadheadLegs > 0).length / trips.length) * 100);
  }, [bidPack]);

  const hotelCountStats = useMemo(() => {
    const hotels = new Set(
      bidPack.lines
        .flatMap((l) => l.trips)
        .flatMap((t) => t.layoverDetails)
        .map((d) => d.hotelName)
        .filter((n): n is string => !!n)
    );
    return hotels.size;
  }, [bidPack]);

  const cityCountStats = useMemo(() => rankLayoverCitiesByFrequency(bidPack).length, [bidPack]);

  function sliderExtraFor(key: string) {
    if (key === "tripLength" && tripLengthStats) {
      return (
        <StatCallout
          stats={[
            { label: "Shortest trip in this bid pack", value: `${tripLengthStats.min}-day` },
            { label: "Longest trip in this bid pack", value: `${tripLengthStats.max}-day` },
          ]}
        />
      );
    }
    if (key === "reportTime" && reportTimeStats) {
      return (
        <StatCallout
          stats={[
            { label: "Earliest report in this bid pack", value: formatHHMM(reportTimeStats.earliest) },
            { label: "Latest report in this bid pack", value: formatHHMM(reportTimeStats.latest) },
          ]}
        />
      );
    }
    if (key === "creditHours") {
      return (
        <StatCallout
          stats={[
            { label: "Leanest line in this bid pack", value: `${formatHoursValue(ranges.creditHours[0])} credit` },
            { label: "Max line in this bid pack", value: `${formatHoursValue(ranges.creditHours[1])} credit` },
          ]}
        />
      );
    }
    if (key === "deadheadTolerance" && deadheadStats !== null) {
      return (
        <StatCallout
          stats={[
            {
              label: "of trips in this bid pack include at least one deadhead leg",
              value: `${deadheadStats}%`,
            },
          ]}
        />
      );
    }
    if (key === "hotelQuiet") {
      return (
        <StatCallout
          stats={[
            { label: "distinct layover hotels assigned across this bid pack", value: String(hotelCountStats) },
          ]}
        />
      );
    }
    if (key === "hotelQuality") {
      return (
        <StatCallout
          stats={[{ label: "distinct layover cities across this bid pack", value: String(cityCountStats) }]}
        />
      );
    }
    return undefined;
  }

  const [phase, setPhase] = useState<Phase>("commuter");
  const [quickIndex, setQuickIndex] = useState(0);
  const [deepSliderIndex, setDeepSliderIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [tradeoffIndex, setTradeoffIndex] = useState(0);

  const [isCommuter, setIsCommuter] = useState<boolean | null>(null);
  const [hasCrashPad, setHasCrashPad] = useState<boolean | null>(null);
  const [weights, setWeights] = useState(emptyWeights());
  const [tradeoffAnswers, setTradeoffAnswers] = useState<
    Record<string, number>
  >({});
  const [explicitTargets, setExplicitTargets] = useState<
    Partial<Record<ExplicitTargetKey, number>>
  >({});
  const [cityPreferences, setCityPreferences] = useState<
    Record<string, CitySentiment>
  >({});

  const activeDeepSteps = useMemo(
    () =>
      DEEP_STEPS.map((s) =>
        s.kind === "slider" && s.config.key === "deadheadTolerance"
          ? { kind: "slider" as const, config: deadheadQuestionFor(isCommuter) }
          : s
      ),
    [isCommuter]
  );
  const activeTradeoffs = TRADEOFF_QUESTIONS;

  const currentQuickStep = QUICK_STEPS[quickIndex];
  const currentDeepStep = activeDeepSteps[deepSliderIndex];
  const currentTarget = TARGET_SLIDERS[targetIndex];
  const currentTradeoff = activeTradeoffs[tradeoffIndex];

  const totalSteps = useMemo(
    () =>
      1 + // commuter
      QUICK_STEPS.length +
      activeDeepSteps.length +
      TARGET_SLIDERS.length +
      activeTradeoffs.length,
    [activeDeepSteps.length, activeTradeoffs.length]
  );
  const stepsDone =
    phase === "commuter"
      ? 0
      : phase === "quick"
        ? 1 + quickIndex
        : phase === "deep-sliders"
          ? 1 + QUICK_STEPS.length + deepSliderIndex
          : phase === "deep-targets"
            ? 1 + QUICK_STEPS.length + activeDeepSteps.length + targetIndex
            : phase === "deep-tradeoffs"
              ? 1 +
                QUICK_STEPS.length +
                activeDeepSteps.length +
                TARGET_SLIDERS.length +
                tradeoffIndex
              : 1 + QUICK_STEPS.length;

  function finish(deepRoundCompleted: boolean) {
    const answers: TradeoffAnswer[] = Object.entries(tradeoffAnswers).map(
      ([id, value]) => ({ id, value })
    );
    onComplete(
      buildProfile(
        weights,
        deepRoundCompleted,
        answers,
        explicitTargets,
        isCommuter,
        cityPreferences,
        hasCrashPad
      )
    );
  }

  function goQuickNext() {
    if (quickIndex < QUICK_STEPS.length - 1) {
      setQuickIndex(quickIndex + 1);
    } else {
      setPhase("deep-offer");
    }
  }

  function goQuickBack() {
    if (quickIndex > 0) setQuickIndex(quickIndex - 1);
    else setPhase("commuter");
  }

  function goDeepSliderNext() {
    if (deepSliderIndex < activeDeepSteps.length - 1) {
      setDeepSliderIndex(deepSliderIndex + 1);
    } else {
      setTargetIndex(0);
      setPhase("deep-targets");
    }
  }

  function goTargetNext() {
    if (targetIndex < TARGET_SLIDERS.length - 1) {
      setTargetIndex(targetIndex + 1);
    } else {
      setTradeoffIndex(0);
      setPhase("deep-tradeoffs");
    }
  }

  function goTargetBack() {
    if (targetIndex > 0) {
      setTargetIndex(targetIndex - 1);
    } else {
      setDeepSliderIndex(activeDeepSteps.length - 1);
      setPhase("deep-sliders");
    }
  }

  function goTradeoffNext() {
    if (tradeoffIndex < activeTradeoffs.length - 1) {
      setTradeoffIndex(tradeoffIndex + 1);
    } else {
      finish(true);
    }
  }

  function goTradeoffBack() {
    if (tradeoffIndex > 0) {
      setTradeoffIndex(tradeoffIndex - 1);
    } else {
      setTargetIndex(TARGET_SLIDERS.length - 1);
      setPhase("deep-targets");
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-8 flex items-center justify-between">
        <ProgressDots total={totalSteps} current={Math.min(stepsDone, totalSteps - 1)} />
        <span className="font-mono text-xs text-ink-faint">
          {phase === "deep-offer" ? "almost there" : `${stepsDone + 1} / ${totalSteps}`}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        {phase === "commuter" && (
          <div className="animate-fade-in">
            <CommuterStep value={isCommuter} onChange={setIsCommuter} />
            <StepNav onNext={() => setPhase("quick")} nextLabel="Next" />
          </div>
        )}

        {phase === "quick" && (
          <div key={`quick-${quickIndex}`} className="animate-fade-in">
            {currentQuickStep.kind === "slider" && (
              <SliderStep
                config={currentQuickStep.config}
                value={weights[currentQuickStep.config.key as QuickQuestionKey]}
                onChange={(v) =>
                  setWeights((w) => ({ ...w, [currentQuickStep.config.key]: v }))
                }
                extra={sliderExtraFor(currentQuickStep.config.key)}
              />
            )}
            {currentQuickStep.kind === "target" && (
              <div>
                <TargetSliderStep
                  config={currentQuickStep.config}
                  range={ranges[currentQuickStep.config.key]}
                  value={explicitTargets[currentQuickStep.config.key]}
                  onChange={(v) =>
                    setExplicitTargets((t) => ({ ...t, [currentQuickStep.config.key]: v }))
                  }
                />
                {currentQuickStep.showCrashPad && isCommuter === true && (
                  <CrashPadToggle value={hasCrashPad} onChange={setHasCrashPad} />
                )}
              </div>
            )}
            {currentQuickStep.kind === "cities" && (
              <CityPreferenceStep
                cities={topCities}
                preferences={cityPreferences}
                onToggleCity={(code) =>
                  setCityPreferences((prev) => cycleCitySentiment(prev, code))
                }
              />
            )}
            <StepNav
              onBack={goQuickBack}
              onNext={goQuickNext}
              nextLabel={
                quickIndex === QUICK_STEPS.length - 1 ? "Continue" : "Next"
              }
            />
          </div>
        )}

        {phase === "deep-offer" && (
          <div className="animate-fade-in">
            <DeepOffer
              onSkip={() => finish(false)}
              onContinue={() => setPhase("deep-sliders")}
            />
          </div>
        )}

        {phase === "deep-sliders" && (
          <div key={`deep-slider-${deepSliderIndex}`} className="animate-fade-in">
            {currentDeepStep.kind === "slider" && (
              <SliderStep
                config={currentDeepStep.config}
                value={weights[currentDeepStep.config.key]}
                onChange={(v) =>
                  setWeights((w) => ({ ...w, [currentDeepStep.config.key]: v }))
                }
                extra={sliderExtraFor(currentDeepStep.config.key)}
              />
            )}
            {currentDeepStep.kind === "amenities" && (
              <HotelAmenitiesStep
                weights={weights}
                onToggle={(key) =>
                  setWeights((w) => ({
                    ...w,
                    [key]: w[key] > 0 ? 0 : HOTEL_AMENITY_WEIGHT,
                  }))
                }
              />
            )}
            <StepNav
              onBack={() => setPhase("deep-offer")}
              onNext={goDeepSliderNext}
              nextLabel="Next"
            />
          </div>
        )}

        {phase === "deep-targets" && (
          <div key={`target-${targetIndex}`} className="animate-fade-in">
            <TargetSliderStep
              config={currentTarget}
              range={ranges[currentTarget.key]}
              value={explicitTargets[currentTarget.key]}
              onChange={(v) =>
                setExplicitTargets((t) => ({ ...t, [currentTarget.key]: v }))
              }
            />
            <StepNav onBack={goTargetBack} onNext={goTargetNext} nextLabel="Next" />
          </div>
        )}

        {phase === "deep-tradeoffs" && (
          <div key={`tradeoff-${tradeoffIndex}`} className="animate-fade-in">
            <TradeoffStep
              config={currentTradeoff}
              value={tradeoffAnswers[currentTradeoff.id] ?? 0}
              onChange={(v) =>
                setTradeoffAnswers((a) => ({ ...a, [currentTradeoff.id]: v }))
              }
            />
            <StepNav
              onBack={goTradeoffBack}
              onNext={goTradeoffNext}
              nextLabel={
                tradeoffIndex === activeTradeoffs.length - 1
                  ? "See my results"
                  : "Next"
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DeepOffer({
  onSkip,
  onContinue,
}: {
  onSkip: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink sm:text-2xl">
        Want to fine-tune further?
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        A few more questions &mdash; layover hotel amenities, an exact credit
        target you can pin down, and some quick &ldquo;would you
        rather&rdquo; trade-offs &mdash; can sharpen your ranking well beyond
        what the quick round alone captures. Takes about two minutes.
      </p>
      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
        <Button variant="secondary" onClick={onSkip} className="sm:flex-1">
          Skip, show my results
        </Button>
        <Button onClick={onContinue} className="sm:flex-1">
          Continue fine-tuning
        </Button>
      </div>
    </div>
  );
}

/** A real, bid-pack-derived stat (or pair of them) shown between a slider question's help text and its dial — grounds the abstract slider in this specific pilot's actual bid pack instead of a generic dial. */
function StatCallout({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <div className={`mt-6 grid gap-3 ${stats.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
      {stats.map((s, i) => (
        <div key={i} className="rounded-lg border border-border bg-canvas px-4 py-3 text-center">
          <div className="font-mono text-xl font-semibold text-brand">{s.value}</div>
          <div className="mt-1 text-xs text-ink-faint">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function CrashPadToggle({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-canvas p-4">
      <div className="text-sm font-medium text-ink">Got a crash pad in domicile?</div>
      <p className="mt-1 text-xs text-ink-muted">
        Worth factoring in &mdash; without a place to stage between duty days, an
        extra separate trip costs you more than it would otherwise.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-all ${
            value === true
              ? "border-brand bg-brand-soft text-brand"
              : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
          }`}
        >
          Yes, I&rsquo;ve got a place
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
          className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-all ${
            value === false
              ? "border-brand bg-brand-soft text-brand"
              : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
          }`}
        >
          No crash pad
        </button>
      </div>
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="mt-10 flex items-center justify-between">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button onClick={onNext}>{nextLabel}</Button>
    </div>
  );
}
