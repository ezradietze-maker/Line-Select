import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Slider } from "@/components/ui/Slider";
import {
  ALL_TARGET_CONFIGS,
  DEEP_SLIDERS,
  HOTEL_AMENITIES,
  QUICK_QUESTIONS,
  deadheadQuestionFor,
  type SliderQuestionConfig,
} from "@/lib/interview-config";
import type { PreferenceProfile } from "@/types/preferences";

interface PreferencesScreenProps {
  hasBidPack: boolean;
  profile: PreferenceProfile | null;
  onGoToUpload: () => void;
  onStartInterview: () => void;
}

export function PreferencesScreen({
  hasBidPack,
  profile,
  onGoToUpload,
  onStartInterview,
}: PreferencesScreenProps) {
  if (!hasBidPack) {
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

  const completedDate = new Date(profile.completedAt);
  const deepSliders = DEEP_SLIDERS.map((s) =>
    s.key === "deadheadTolerance" ? deadheadQuestionFor(profile.isCommuter) : s
  );
  const selectedAmenities = HOTEL_AMENITIES.filter((a) => profile.weights[a.key] > 0);
  const lovedCities = Object.entries(profile.cityPreferences)
    .filter(([, sentiment]) => sentiment === "love")
    .map(([code]) => code);
  const avoidedCities = Object.entries(profile.cityPreferences)
    .filter(([, sentiment]) => sentiment === "avoid")
    .map(([code]) => code);

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Your preferences</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>
              Last answered {completedDate.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            {profile.deepRoundCompleted && (
              <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                Deep interview
              </span>
            )}
            {profile.isCommuter !== null && (
              <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                {profile.isCommuter ? "Commuter" : "Local"}
              </span>
            )}
            {profile.isCommuter === true && profile.hasCrashPad !== null && (
              <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs font-medium text-ink-faint">
                {profile.hasCrashPad ? "Has a crash pad" : "No crash pad"}
              </span>
            )}
          </p>
        </div>
        <Button onClick={onStartInterview}>Retake the interview</Button>
      </div>

      <div className="mt-6 space-y-3 rounded-xl border border-border bg-surface p-5 sm:p-6">
        {QUICK_QUESTIONS.map((config) => (
          <WeightRow key={config.key} config={config} weight={profile.weights[config.key]} />
        ))}
        {deepSliders.map((config) => (
          <WeightRow key={config.key} config={config} weight={profile.weights[config.key]} />
        ))}
      </div>

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

      {Object.keys(profile.explicitTargets).length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Exact targets you pinned
          </h2>
          <div className="mt-3 space-y-2">
            {ALL_TARGET_CONFIGS.filter((t) => profile.explicitTargets[t.key] !== undefined).map(
              (t) => (
                <div key={t.key} className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted">{t.question}</span>
                  <span className="font-mono font-semibold text-ink">
                    {t.formatValue(profile.explicitTargets[t.key]!)} {t.unitPlural}
                  </span>
                </div>
              )
            )}
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

    </div>
  );
}

function WeightRow({ config, weight }: { config: SliderQuestionConfig; weight: number }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-ink">{config.question}</div>
      <Slider
        readOnly
        value={weight}
        onChange={() => {}}
        lowLabel={config.lowLabel}
        highLabel={config.highLabel}
        centerLabel={config.centerLabel}
        ariaLabel={config.question}
      />
    </div>
  );
}
