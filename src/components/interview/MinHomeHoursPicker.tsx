"use client";

import { DEFAULT_MIN_HOME_HOURS } from "@/lib/metrics/departures";

/** The hours-at-home choices a commuter picks from: half a day to two days. */
export const MIN_HOME_CHOICES = [12, 24, 36, 48] as const;

const label = (h: number) => (h === 48 ? "2 days" : `${h} hours`);

/**
 * How much time at home makes it worth going home between two trips — under it a commuter stays at base, and the trips
 * on either side are one departure (`metrics/departures.ts`). Asked with the crash pad, and changeable on Preferences.
 */
export function MinHomeHoursPicker({ value, onChange, base, id = "min-home-hours" }: { value: number | null | undefined; onChange: (hours: number) => void; base: string; id?: string }) {
  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <div id={`${id}-label`} className="text-sm font-medium text-ink">
        Between two trips, how much time at home makes it worth going home?
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Door to door, after the trip home and before the trip back. Less than this and you&rsquo;d stay in {base}, so the trips on either side count as one
        departure.{value ? "" : ` Skip it and we use ${DEFAULT_MIN_HOME_HOURS} hours.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MIN_HOME_CHOICES.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={value === h}
            onClick={() => onChange(h)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${value === h ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong"}`}
          >
            {label(h)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The answer as the pilot would say it, for the interview transcript the brain reads. */
export function minHomeHoursSentence(hours: number | null | undefined): string {
  return hours ? ` I'd go home between trips if I'd get at least ${label(hours)} at home; less than that and I stay at base.` : "";
}
