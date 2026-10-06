"use client";

import { useState, type ReactNode } from "react";
import { BidDeadlineEditor, formatTimeLeft, urgencyFor, useBidDeadline, useTimeLeft, type Urgency } from "@/components/results/BidCountdown";
import { BidPeriodChangeBanner } from "@/components/results/BidPeriodChangeBanner";
import { ForecastBanner } from "@/components/results/ForecastBanner";
import { PilotProfileSummary } from "@/components/results/PilotProfileSummary";
import type { BidPeriodChangeSummary } from "@/lib/bid-period-history";
import type { ProfileRichness } from "@/lib/interview-engine";
import type { BidForecast } from "@/lib/forecast/forecast";
import type { ForecastResponse } from "@/lib/forecast/forecast-client";
import type { PreferenceProfile } from "@/types/preferences";

type TileId = "deadline" | "chances" | "profile" | "since";

const URGENCY_TEXT: Record<Urgency, string> = {
  calm: "text-readout",
  soon: "text-accent",
  today: "text-warn",
  imminent: "text-danger",
  closed: "text-ink-muted",
};

/** One annunciator on the panel: a label, a readout, a hint — and a drawer of detail when pressed. */
function Tile({
  id,
  label,
  value,
  hint,
  valueClass = "text-readout",
  open,
  onToggle,
  pulse = false,
}: {
  id: TileId;
  label: string;
  value: ReactNode;
  hint: ReactNode;
  valueClass?: string;
  open: boolean;
  onToggle: () => void;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`status-drawer-${id}`}
      className={`group min-w-0 rounded-xl border px-3.5 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
        open ? "border-accent/60 bg-accent-soft/50" : "border-hairline bg-canvas/40 hover:border-border-strong hover:bg-canvas/70"
      }`}
    >
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <span className="truncate">{label}</span>
        {pulse && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-danger shadow-[0_0_6px_var(--color-danger)]" aria-hidden />}
      </div>
      <div className={`mt-1 truncate font-mono text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-ink-muted group-hover:text-ink">{hint}</div>
    </button>
  );
}

interface ResultsStatusPanelProps {
  bidPackId: string;
  profile: PreferenceProfile;
  confidenceLevel: ProfileRichness["level"] | null;
  onEditPreferences: () => void;
  bidPeriodChange: BidPeriodChangeSummary | null;
  forecast: {
    hasList: boolean;
    forecast: BidForecast | null;
    response: ForecastResponse | null;
    loading: boolean;
    failed: boolean;
    realisticCount: number;
    showingRealistic: boolean;
    onToggleRealistic: () => void;
    canShare: boolean;
    sharing: boolean;
    onSharingChange: (next: boolean) => void;
  };
}

/**
 * Everything that used to stack up above the first line — the bid deadline,
 * your chances, what the profile's built on, what changed since last month —
 * as one panel of readouts. Each says its one number at a glance; pressing
 * it opens the detail underneath. The ranking itself is no longer pushed
 * below the fold by four separate notices.
 */
export function ResultsStatusPanel({
  bidPackId,
  profile,
  confidenceLevel,
  onEditPreferences,
  bidPeriodChange,
  forecast: f,
}: ResultsStatusPanelProps) {
  const [open, setOpen] = useState<TileId | null>(null);
  const toggle = (id: TileId) => setOpen((cur) => (cur === id ? null : id));
  const deadline = useBidDeadline(bidPackId);
  const msLeft = useTimeLeft(deadline.deadline);
  const urgency = msLeft === null ? null : urgencyFor(msLeft);
  const time = msLeft !== null && msLeft > 0 ? formatTimeLeft(msLeft) : null;

  const inYourWords = profile.discoveredFacts.filter((x) => x.kind === "qualitative").length;
  const depth =
    confidenceLevel === "thorough" ? "Thorough" : confidenceLevel === "moderate" ? "Moderate" : confidenceLevel === "thin" ? "Short" : profile.deepRoundCompleted ? "Deep" : "Set";

  return (
    <section aria-label="Bid status" className="panel-glass mt-5 p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {deadline.loaded && (
          <Tile
            id="deadline"
            label="Bid closes"
            open={open === "deadline"}
            onToggle={() => toggle("deadline")}
            valueClass={urgency ? URGENCY_TEXT[urgency] : "text-ink-faint"}
            pulse={urgency === "imminent"}
            value={
              time ? (
                <>
                  {time.main}
                  {time.seconds && <span className="text-[0.75em] opacity-70">:{time.seconds}</span>}
                </>
              ) : urgency === "closed" ? (
                "Closed"
              ) : (
                "—"
              )
            }
            hint={deadline.deadline ? (urgency === "closed" ? "Set a new one" : "Change") : "Set a live countdown"}
          />
        )}
        {f.hasList && (
          <Tile
            id="chances"
            label="Your chances"
            open={open === "chances"}
            onToggle={() => toggle("chances")}
            value={!profile.seniorityNumber ? "—" : f.forecast ? f.realisticCount : f.failed ? "—" : "…"}
            valueClass={!profile.seniorityNumber ? "text-ink-faint" : "text-readout"}
            hint={!profile.seniorityNumber ? "Add your seniority" : f.forecast ? "lines you could hold" : f.failed ? "Couldn’t estimate" : "Estimating…"}
          />
        )}
        <Tile
          id="profile"
          label="Your profile"
          open={open === "profile"}
          onToggle={() => toggle("profile")}
          value={depth}
          valueClass={confidenceLevel === "thin" ? "text-warn" : "text-readout"}
          hint={inYourWords > 0 ? `${inYourWords} in your words` : "What it’s built on"}
        />
        {bidPeriodChange && (
          <Tile
            id="since"
            label={`Since ${bidPeriodChange.previousMonth}`}
            open={open === "since"}
            onToggle={() => toggle("since")}
            value={bidPeriodChange.sameTopLine ? "Same #1" : "New #1"}
            hint={`Line ${bidPeriodChange.currentTopLine}`}
          />
        )}
      </div>

      {open && (
        <div id={`status-drawer-${open}`} className="animate-fade-in mt-3 border-t border-hairline px-1 pt-4">
          {open === "deadline" && (
            <BidDeadlineEditor deadline={deadline.deadline} onSave={deadline.save} onClear={deadline.clear} onDone={() => setOpen(null)} />
          )}
          {open === "chances" && (
            <ForecastBanner
              bare
              forecast={f.forecast}
              response={f.response}
              loading={f.loading}
              failed={f.failed}
              seniorityNumber={profile.seniorityNumber}
              hasList={f.hasList}
              onAddSeniority={onEditPreferences}
              realisticCount={f.realisticCount}
              showingRealistic={f.showingRealistic}
              onToggleRealistic={f.onToggleRealistic}
              canShare={f.canShare}
              sharing={f.sharing}
              onSharingChange={f.onSharingChange}
            />
          )}
          {open === "profile" && (
            <div className="space-y-4">
              {(confidenceLevel === "thin" || confidenceLevel === "moderate") && (
                <p className="text-sm text-ink-muted">
                  These rankings are based on a{confidenceLevel === "thin" ? " shorter" : " moderate-length"} interview
                  {confidenceLevel === "thin" ? ", so treat them as a first cut" : ""}.
                </p>
              )}
              {inYourWords > 0 && (
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">In your words</div>
                  <PilotProfileSummary profile={profile} bare />
                </div>
              )}
              <button
                type="button"
                onClick={onEditPreferences}
                className="text-sm font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-ink"
              >
                Review or sharpen your preferences
              </button>
            </div>
          )}
          {open === "since" && <BidPeriodChangeBanner summary={bidPeriodChange} bare />}
        </div>
      )}
    </section>
  );
}
