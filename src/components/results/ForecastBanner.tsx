"use client";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { LIKELIHOOD_LABEL, type BidForecast, type Likelihood, type LineForecast } from "@/lib/forecast/forecast";
import type { ForecastResponse } from "@/lib/forecast/forecast-client";

const TONE: Record<Likelihood, string> = {
  "very-likely": "border-good/40 bg-good-soft text-good",
  likely: "border-good/30 bg-good-soft/60 text-good",
  possible: "border-border-strong bg-canvas text-ink-muted",
  "long-shot": "border-warn/40 bg-warn-soft text-warn",
  "out-of-reach": "border-danger/30 bg-danger-soft text-danger",
};

const percent = (p: number) => `${Math.round(p * 100)}%`;

/** How likely a line is to still be there when it's the pilot's turn to pick — the one number on each card that says whether it's worth their time. */
export function ForecastChip({ forecast }: { forecast: LineForecast }) {
  const award = forecast.pAward >= 0.05 ? ` · ${percent(forecast.pAward)} you're awarded it` : "";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[forecast.likelihood]}`}
      title={`Chance this line is still open when it's your turn to pick: ${percent(forecast.pAvailable)}. Chance it's the line you're actually awarded from your ranking: ${percent(forecast.pAward)}.`}
    >
      {LIKELIHOOD_LABEL[forecast.likelihood]} · {percent(forecast.pAvailable)} open{award}
    </span>
  );
}

const CONFIDENCE_TEXT = {
  low: "A first estimate from your seat's bid list alone.",
  medium: "Sharpening — some of the pilots ahead of you have shared their rankings.",
  high: "Most of the pilots ahead of you have shared their rankings, so this is a firm read.",
} as const;

interface ForecastBannerProps {
  forecast: BidForecast | null;
  response: ForecastResponse | null;
  loading: boolean;
  seniorityNumber: number | null | undefined;
  hasList: boolean;
  onAddSeniority: () => void;
  realisticCount: number;
  showingRealistic: boolean;
  onToggleRealistic: () => void;
  canShare: boolean;
  sharing: boolean;
  onSharingChange: (next: boolean) => void;
}

export function ForecastBanner({
  forecast,
  response,
  loading,
  seniorityNumber,
  hasList,
  onAddSeniority,
  realisticCount,
  showingRealistic,
  onToggleRealistic,
  canShare,
  sharing,
  onSharingChange,
}: ForecastBannerProps) {
  if (!hasList) return null;

  if (!seniorityNumber) {
    return (
      <div className="mt-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="text-sm font-semibold text-ink">Which of these lines could you actually hold?</div>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Add your seniority number and Line Select will estimate your chance at every line &mdash; so you can spend your time on lines
          you could really get, not ones the pilots senior to you will take first.
        </p>
        <Button className="mt-3" variant="secondary" onClick={onAddSeniority}>
          Add my seniority number
        </Button>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm text-ink-muted">
        <Spinner size="sm" />
        Estimating your chances at seniority #{seniorityNumber}&hellip;
      </div>
    );
  }

  const sharingPilots = response?.pilotsSharing ?? 0;

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface p-4 sm:p-5" aria-busy={loading}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-sm font-semibold text-ink">
          Your chances &middot; seniority #{seniorityNumber} &middot; {forecast.exactPosition ? "" : "about "}
          {forecast.myBidNumber} of {forecast.totalPilots} in bid order
        </div>
        {loading && <span className="text-xs text-ink-faint">updating&hellip;</span>}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-ink">{forecast.outlook}</p>
      {forecast.pTop[5] !== undefined && forecast.pilotsAhead > 0 && (
        <p className="mt-1 text-xs text-ink-muted">
          {percent(forecast.pTop[1] ?? 0)} you get your #1 &middot; {percent(forecast.pTop[5])} one of your top 5 &middot; {percent(forecast.pTop[10] ?? forecast.pTop[5])} one of your top 10
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant={showingRealistic ? "primary" : "secondary"} onClick={onToggleRealistic}>
          {showingRealistic ? "Showing realistic lines" : `Show only lines I could realistically hold (${realisticCount})`}
        </Button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        {CONFIDENCE_TEXT[forecast.confidence]}{" "}
        {sharingPilots > 0 && `${sharingPilots} pilot${sharingPilots === 1 ? " has" : "s have"} shared a ranking for this seat. `}
        {response?.local && "Couldn't reach the server, so this was worked out on your device from the pack alone. "}
        This is an estimate, not a promise &mdash; it gets sharper as more pilots at your base and seat use Line Select.
      </p>

      {canShare && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-ink-muted">
          <input type="checkbox" checked={sharing} onChange={(e) => onSharingChange(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border-strong text-brand" />
          <span>
            Help other pilots&rsquo; forecasts by sharing my ranking. It&rsquo;s stored with my place in bid order &mdash; never my name or email &mdash; and
            only ever used to estimate what lines will be taken. Uncheck to remove it.
          </span>
        </label>
      )}
    </div>
  );
}
