"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Heading } from "@/components/ui/Heading";
import { ProgressDots } from "@/components/ui/ProgressDots";
import { ScreenTransition } from "@/components/ui/ScreenTransition";
import { SelectableCard } from "@/components/ui/SelectableCard";
import { Spinner } from "@/components/ui/Spinner";
import { CityPreferenceStep } from "@/components/interview/CityPreferenceStep";
import { CommuterStep } from "@/components/interview/CommuterStep";
import { FreeTextAnswerBox } from "@/components/interview/FreeTextAnswerBox";
import { SliderStep } from "@/components/interview/SliderStep";
import { TargetSliderStep } from "@/components/interview/TargetSliderStep";
import {
  QUICK_STEPS,
  deadheadQuestionFor,
  formatHoursValue,
  type QuickStepConfig,
  type SliderQuestionConfig,
} from "@/lib/interview-config";
import {
  HARD_CEILING_TURNS,
  SOFT_CAP_TURNS,
  applyProfileUpdates,
  buildTurnRequest,
  finalizeAdaptiveProfile,
} from "@/lib/interview-engine";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { cycleCitySentiment, emptyWeights } from "@/lib/preference-logic";
import { getBidPackRanges, rankLayoverCitiesByFrequency } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type {
  InterviewAnswer,
  InterviewQuestion,
  InterviewTurnRecord,
  PreferenceFact,
  TurnResponse,
} from "@/types/interview-session";
import type { CitySentiment, ExplicitTargetKey, PreferenceProfile, PreferenceWeights } from "@/types/preferences";

/**
 * Replaces the old fixed-order `Interview.tsx` with a conversational flow:
 * a short guaranteed-baseline seed sequence (home time/domicile, trip
 * length, departures, cities, report time, pay-vs-lifestyle, circadian
 * health, deadhead — the same ground the brief itself names as anchor
 * coverage), then a live turn loop against `/api/interview-turn` that asks
 * whatever it judges is actually worth asking next, until it wraps up, the
 * pilot ends early, or the hard turn ceiling is hit.
 *
 * Seed answers never touch the network — each one is a deterministic,
 * lossless conversion straight from the slider/target value into a
 * `PreferenceFact` (see `factsFromSeedStep`), the same arithmetic the
 * legacy interview already did, just expressed as a fact instead of a
 * direct weight write. The first live LLM call only happens once every
 * seed question has been asked, so the guaranteed baseline really is free
 * and instant, and the model's first real turn already has the full seed
 * transcript as context.
 *
 * Scope note: the legacy interview's separate hotel-amenities multi-select
 * and "would you rather" trade-off cards are not part of the guaranteed
 * seed set here — the model already asks about layover quality and similar
 * trade-offs organically when a pilot's answers suggest it matters (see the
 * live transcripts from Phase 2), which is more in the spirit of an
 * adaptive interview than forcing every pilot through a fixed deep round.
 */

interface AdaptiveInterviewProps {
  bidPack: BidPack;
  onComplete: (profile: PreferenceProfile) => void;
}

const MAX_CITY_CHOICES = 12;

type Phase = "commuter" | "seed" | "adaptive-loading" | "adaptive-question" | "finishing";

function seedStatement(config: SliderQuestionConfig, value: number): string {
  const label = Math.abs(value) < 10 ? config.centerLabel : value > 0 ? config.highLabel : config.lowLabel;
  return `${config.question} — ${label}.`;
}

/** Deterministic, network-free conversion of one answered seed step into zero or more facts — a slider left at 0 (no strong preference) produces nothing to score, matching the legacy interview's own "importance floor" behavior. */
function factsFromSeedStep(
  step: QuickStepConfig,
  weights: PreferenceWeights,
  explicitTargets: Partial<Record<ExplicitTargetKey, number>>,
  turnIndex: number
): PreferenceFact[] {
  if (step.kind === "slider") {
    const key = step.config.key;
    const value = weights[key];
    if (value === 0) return [];
    return [
      {
        id: crypto.randomUUID(),
        statement: seedStatement(step.config, value),
        kind: "measurable",
        measurable: { type: "explicit-weight", key, direction: value > 0 ? 1 : -1 },
        confidence: 1,
        importance: Math.min(1, Math.abs(value) / 100),
        source: { kind: "seed-question", questionKey: key },
        turnIndex,
      },
    ];
  }
  if (step.kind === "target") {
    const value = explicitTargets[step.config.key];
    if (value === undefined) return [];
    const unit = value === 1 ? step.config.unitSingular : step.config.unitPlural;
    return [
      {
        id: crypto.randomUUID(),
        statement: `Wants ${step.config.formatValue(value)} ${unit} this bid period.`,
        kind: "measurable",
        measurable: { type: "explicit-target", key: step.config.key, value },
        confidence: 1,
        importance: 0.7,
        source: { kind: "seed-question", questionKey: step.config.key },
        turnIndex,
      },
    ];
  }
  return []; // "cities" is threaded straight through as cityPreferencesSeed instead — see finalizeAdaptiveProfile.
}

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

function StepNav({ onNext, nextLabel, disabled }: { onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div className="mt-10 flex items-center justify-end">
      <Button onClick={onNext} disabled={disabled}>
        {nextLabel}
      </Button>
    </div>
  );
}

/**
 * "Free-text elaboration... should always be an option, not just a slider"
 * — offered on every adaptive slider/target-slider/choice question, not
 * only when the model itself happens to pick "free-text" as the question
 * kind. Collapsed by default so it doesn't visually compete with the
 * primary answer control; the pilot opts in only if they actually want to
 * explain themselves. Read by the same extraction call that already
 * processes the primary answer — no extra network round trip.
 */
function ElaborationToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(value.length > 0);
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-4 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
      >
        Want to explain why?
      </button>
    );
  }
  return (
    <div className="mt-4">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional — anything about this answer worth knowing"
        rows={2}
        className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
      />
    </div>
  );
}

export function AdaptiveInterview({ bidPack, onComplete }: AdaptiveInterviewProps) {
  const grounding = useMemo(() => computeBidPackGroundingStats(bidPack), [bidPack]);
  const ranges = useMemo(() => getBidPackRanges(bidPack), [bidPack]);
  const topCities = useMemo(
    () => rankLayoverCitiesByFrequency(bidPack).slice(0, MAX_CITY_CHOICES).map((c) => c.code),
    [bidPack]
  );

  const [phase, setPhase] = useState<Phase>("commuter");
  const [isCommuter, setIsCommuter] = useState<boolean | null>(null);
  const [hasCrashPad, setHasCrashPad] = useState<boolean | null>(null);
  const [cityPreferences, setCityPreferences] = useState<Record<string, CitySentiment>>({});
  const [weights, setWeights] = useState(emptyWeights());
  const [explicitTargets, setExplicitTargets] = useState<Partial<Record<ExplicitTargetKey, number>>>({});

  const [seedIndex, setSeedIndex] = useState(0);
  const [facts, setFacts] = useState<PreferenceFact[]>([]);
  const [transcript, setTranscript] = useState<InterviewTurnRecord[]>([]);
  const [turnsUsed, setTurnsUsed] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  const [choiceSelection, setChoiceSelection] = useState<number | null>(null);
  const [choiceElaboration, setChoiceElaboration] = useState("");
  const [error, setError] = useState<string | null>(null);

  const seedSteps = useMemo(() => [...QUICK_STEPS, { kind: "slider" as const, config: deadheadQuestionFor(isCommuter) }], [isCommuter]);
  const currentSeedStep = seedSteps[seedIndex];

  function finish(finalFacts: PreferenceFact[], finalTranscript: InterviewTurnRecord[]) {
    setPhase("finishing");
    const profile = finalizeAdaptiveProfile({
      facts: finalFacts,
      transcript: finalTranscript,
      isCommuter,
      hasCrashPad,
      cityPreferencesSeed: cityPreferences,
    });
    onComplete(profile);
  }

  async function requestNextTurn(nextFacts: PreferenceFact[], nextTranscript: InterviewTurnRecord[], nextTurnsUsed: number) {
    setPhase("adaptive-loading");
    setError(null);
    try {
      const body = buildTurnRequest({
        transcript: nextTranscript,
        facts: nextFacts,
        grounding,
        base: bidPack.base,
        aircraft: bidPack.aircraft,
        isCommuter,
        turnsUsed: nextTurnsUsed,
        // turnsUsed is a running counter starting from the guaranteed seed
        // questions (0-7) — sending that raw number to the model as its
        // budget would make the very first adaptive question look like
        // turn 8 of a 10-turn soft cap. This is what the model (and the
        // hard-ceiling check below) actually reasons against.
        adaptiveTurnsUsed: Math.max(0, nextTurnsUsed - seedSteps.length),
      });
      const res = await fetch("/api/interview-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't reach the interview service. Try again.");
        setPhase("adaptive-question"); // stay put so the pilot can retry via the same question controls, or finish early
        return;
      }
      const turn = (await res.json()) as TurnResponse;
      const mergedFacts = applyProfileUpdates(nextFacts, turn.profileUpdates);
      setFacts(mergedFacts);

      if (turn.action === "wrap_up" || !turn.question) {
        finish(mergedFacts, nextTranscript);
        return;
      }
      setCurrentQuestion(turn.question);
      setChoiceSelection(null);
      setChoiceElaboration("");
      setPhase("adaptive-question");
    } catch {
      setError("Couldn't reach the interview service. Check your connection and try again.");
      setPhase("adaptive-question");
    }
  }

  function advanceSeed() {
    const newFacts = factsFromSeedStep(currentSeedStep, weights, explicitTargets, seedIndex);
    const nextFacts = [...facts, ...newFacts];
    const nextTurnsUsed = turnsUsed + 1;
    setFacts(nextFacts);
    setTurnsUsed(nextTurnsUsed);

    if (seedIndex < seedSteps.length - 1) {
      setSeedIndex(seedIndex + 1);
      return;
    }
    // Seed coverage complete — hand off to the live turn loop.
    requestNextTurn(nextFacts, transcript, nextTurnsUsed);
  }

  function handleAdaptiveAnswer(answer: InterviewAnswer) {
    if (!currentQuestion) return;
    const nextTranscript: InterviewTurnRecord[] = [
      ...transcript,
      { turnIndex: turnsUsed, question: currentQuestion, answer, profileFactIdsTouched: [] },
    ];
    const nextTurnsUsed = turnsUsed + 1;
    setTranscript(nextTranscript);
    setTurnsUsed(nextTurnsUsed);
    setCurrentQuestion(null);

    if (nextTurnsUsed - seedSteps.length >= HARD_CEILING_TURNS) {
      // Hard ceiling enforced client-side, regardless of what the model would have asked next.
      // Measured from the start of the adaptive loop, not from turnsUsed's raw
      // seed-inclusive value — see the matching comment in requestNextTurn.
      finish(facts, nextTranscript);
      return;
    }
    requestNextTurn(facts, nextTranscript, nextTurnsUsed);
  }

  function sliderExtraFor(key: string) {
    if (key === "tripLength" && grounding.tripLength) {
      return (
        <StatCallout
          stats={[
            { label: "Shortest trip in this bid pack", value: `${grounding.tripLength.min}-day` },
            { label: "Longest trip in this bid pack", value: `${grounding.tripLength.max}-day` },
          ]}
        />
      );
    }
    if (key === "reportTime" && grounding.reportTime) {
      return (
        <StatCallout
          stats={[
            { label: "Earliest report in this bid pack", value: grounding.reportTime.earliest.replace(/^(\d{2})(\d{2})$/, "$1:$2") },
            { label: "Latest report in this bid pack", value: grounding.reportTime.latest.replace(/^(\d{2})(\d{2})$/, "$1:$2") },
          ]}
        />
      );
    }
    if (key === "creditHours") {
      return (
        <StatCallout
          stats={[
            { label: "Leanest line in this bid pack", value: `${formatHoursValue(grounding.creditHours.min)} credit` },
            { label: "Max line in this bid pack", value: `${formatHoursValue(grounding.creditHours.max)} credit` },
          ]}
        />
      );
    }
    if (key === "deadheadTolerance" && grounding.deadheadTripSharePercent !== null) {
      return (
        <StatCallout
          stats={[{ label: "of trips in this bid pack include at least one deadhead leg", value: `${grounding.deadheadTripSharePercent}%` }]}
        />
      );
    }
    return undefined;
  }

  const stepsDone =
    phase === "commuter" ? 0 : 1 + (phase === "seed" ? seedIndex : seedSteps.length) + Math.max(0, turnsUsed - seedSteps.length);
  const totalStepsApprox = 1 + seedSteps.length + SOFT_CAP_TURNS;

  const stepKey =
    phase === "commuter"
      ? "commuter"
      : phase === "seed"
        ? `seed-${seedIndex}`
        : currentQuestion
          ? `q-${currentQuestion.id}`
          : phase;

  const content = (() => {
    if (phase === "commuter") {
      return (
        <div>
          <CommuterStep value={isCommuter} onChange={setIsCommuter} base={bidPack.base} />
          <StepNav onNext={() => setPhase("seed")} nextLabel="Next" disabled={isCommuter === null} />
        </div>
      );
    }

    if (phase === "seed") {
      if (currentSeedStep.kind === "slider") {
        return (
          <div>
            <SliderStep
              config={currentSeedStep.config}
              value={weights[currentSeedStep.config.key as keyof PreferenceWeights]}
              onChange={(v) => setWeights((w) => ({ ...w, [currentSeedStep.config.key]: v }))}
              extra={sliderExtraFor(currentSeedStep.config.key)}
            />
            <StepNav onNext={advanceSeed} nextLabel={seedIndex === seedSteps.length - 1 ? "Continue" : "Next"} />
          </div>
        );
      }
      if (currentSeedStep.kind === "target") {
        return (
          <div>
            <TargetSliderStep
              config={currentSeedStep.config}
              range={ranges[currentSeedStep.config.key]}
              value={explicitTargets[currentSeedStep.config.key]}
              onChange={(v) => setExplicitTargets((t) => ({ ...t, [currentSeedStep.config.key]: v }))}
            />
            {currentSeedStep.showCrashPad && isCommuter === true && (
              <div className="mt-6 rounded-lg border border-border bg-canvas p-4">
                <div className="text-sm font-medium text-ink">Got a crash pad in domicile?</div>
                <p className="mt-1 text-xs text-ink-muted">
                  Worth factoring in — without a place to stage between duty days, an extra separate trip costs
                  you more than it would otherwise.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={hasCrashPad === true}
                    onClick={() => setHasCrashPad(true)}
                    className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-all ${
                      hasCrashPad === true
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
                    }`}
                  >
                    Yes, I&rsquo;ve got a place
                  </button>
                  <button
                    type="button"
                    aria-pressed={hasCrashPad === false}
                    onClick={() => setHasCrashPad(false)}
                    className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-all ${
                      hasCrashPad === false
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
                    }`}
                  >
                    No crash pad
                  </button>
                </div>
              </div>
            )}
            <StepNav onNext={advanceSeed} nextLabel="Next" />
          </div>
        );
      }
      // "cities"
      return (
        <div>
          <CityPreferenceStep
            cities={topCities}
            preferences={cityPreferences}
            onToggleCity={(code) => setCityPreferences((prev) => cycleCitySentiment(prev, code))}
          />
          <StepNav onNext={advanceSeed} nextLabel="Next" />
        </div>
      );
    }

    if (phase === "adaptive-loading") {
      return (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner size="md" />
          <p className="text-sm text-ink-faint">Thinking about what to ask next…</p>
        </div>
      );
    }

    if (phase === "adaptive-question" && currentQuestion) {
      const q = currentQuestion;
      return (
        <div key={q.id}>
          {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}

          {q.kind === "slider" && (
            <>
              <SliderStepInline
                question={q}
                onSubmit={(value, elaboration) => handleAdaptiveAnswer({ kind: "slider", value, elaboration })}
              />
            </>
          )}

          {q.kind === "target-slider" && (
            <TargetSliderStepInline
              question={q}
              range={ranges[q.boundTo]}
              onSubmit={(value, elaboration) => handleAdaptiveAnswer({ kind: "target-slider", value, elaboration })}
            />
          )}

          {q.kind === "choice" && (
            <div>
              <Heading as="h2" className="text-xl text-ink sm:text-2xl">
                {q.prompt}
              </Heading>
              {q.helpText && <p className="mt-1.5 text-sm text-ink-muted">{q.helpText}</p>}
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {q.options.map((opt, i) => (
                  <SelectableCard
                    key={i}
                    label={opt.label}
                    description={opt.description}
                    selected={choiceSelection === i}
                    onClick={() => setChoiceSelection(i)}
                  />
                ))}
              </div>
              <ElaborationToggle value={choiceElaboration} onChange={setChoiceElaboration} />
              <StepNav
                onNext={() =>
                  choiceSelection !== null &&
                  handleAdaptiveAnswer({
                    kind: "choice",
                    selectedIndex: choiceSelection,
                    elaboration: choiceElaboration.trim() || undefined,
                  })
                }
                nextLabel="Next"
                disabled={choiceSelection === null}
              />
            </div>
          )}

          {q.kind === "free-text" && (
            <div>
              <Heading as="h2" className="text-xl text-ink sm:text-2xl">
                {q.prompt}
              </Heading>
              {q.helpText && <p className="mt-1.5 text-sm text-ink-muted">{q.helpText}</p>}
              <div className="mt-8">
                <FreeTextAnswerBox
                  placeholder={q.placeholder}
                  onSubmit={async (text) => handleAdaptiveAnswer({ kind: "free-text", text })}
                  onSkip={() => handleAdaptiveAnswer({ kind: "skipped" })}
                />
              </div>
            </div>
          )}
        </div>
      );
    }

    return null;
  })();

  const canFinishEarly = phase === "adaptive-loading" || phase === "adaptive-question";

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-8 flex items-center justify-between">
        <ProgressDots total={totalStepsApprox} current={Math.min(stepsDone, totalStepsApprox - 1)} />
        <span className="font-mono text-xs text-ink-faint">
          {phase === "commuter" ? "getting started" : `question ${stepsDone + 1} of roughly ${totalStepsApprox}`}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
        <ScreenTransition screenKey={stepKey} direction={1}>
          {content}
        </ScreenTransition>
      </div>

      {canFinishEarly && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => finish(facts, transcript)}
            className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            Finish now, see my results
          </button>
        </div>
      )}
    </div>
  );
}

/** A fresh, self-contained draft for one adaptive slider question — keyed by the parent on `question.id`, so a new question always remounts this with a clean neutral default rather than carrying over the previous question's value. */
function SliderStepInline({
  question,
  onSubmit,
}: {
  question: Extract<InterviewQuestion, { kind: "slider" }>;
  onSubmit: (value: number, elaboration?: string) => void;
}) {
  const [value, setValue] = useState(0);
  const [elaboration, setElaboration] = useState("");
  return (
    <div>
      <SliderStep
        config={{
          key: question.boundTo,
          question: question.prompt,
          helpText: question.helpText,
          lowLabel: question.lowLabel,
          highLabel: question.highLabel,
          centerLabel: question.centerLabel,
        }}
        value={value}
        onChange={setValue}
      />
      <ElaborationToggle value={elaboration} onChange={setElaboration} />
      <StepNav onNext={() => onSubmit(value, elaboration.trim() || undefined)} nextLabel="Next" />
    </div>
  );
}

function TargetSliderStepInline({
  question,
  range,
  onSubmit,
}: {
  question: Extract<InterviewQuestion, { kind: "target-slider" }>;
  range: readonly [number, number];
  onSubmit: (value: number | undefined, elaboration?: string) => void;
}) {
  const [value, setValue] = useState<number | undefined>(Math.round((range[0] + range[1]) / 2));
  const [elaboration, setElaboration] = useState("");
  return (
    <div>
      <TargetSliderStep
        config={{
          key: question.boundTo,
          question: question.prompt,
          helpText: question.helpText ?? "",
          unitSingular: question.unitSingular,
          unitPlural: question.unitPlural,
          formatValue: (v) => String(Math.round(v)),
          step: 1,
        }}
        range={range}
        value={value}
        onChange={setValue}
      />
      <ElaborationToggle value={elaboration} onChange={setElaboration} />
      <StepNav onNext={() => onSubmit(value, elaboration.trim() || undefined)} nextLabel="Next" />
    </div>
  );
}
