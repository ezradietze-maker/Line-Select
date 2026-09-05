"use client";

import { Heading } from "@/components/ui/Heading";
import type { CitySentiment } from "@/types/preferences";

interface CityPreferenceStepProps {
  cities: string[];
  preferences: Record<string, CitySentiment>;
  /** Cycles one city through favorite -> avoid -> no opinion. The caller
   * applies this against the latest state (a functional setState update),
   * not the `preferences` snapshot passed in as a prop — otherwise two
   * taps landing before a re-render (a fast double-tap, common on mobile)
   * would both read the same stale value and the second tap would be lost. */
  onToggleCity: (code: string) => void;
}

export function CityPreferenceStep({
  cities,
  preferences,
  onToggleCity,
}: CityPreferenceStepProps) {
  return (
    <div>
      <Heading as="h2" className="text-xl text-ink sm:text-2xl">
        Any layover cities you love or want to avoid?
      </Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        These are the actual cities in your bid pack. Tap a city to cycle
        through favorite &rarr; avoid &rarr; no opinion. Totally optional.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {cities.map((code) => {
          const sentiment = preferences[code];
          return (
            <button
              key={code}
              type="button"
              onClick={() => onToggleCity(code)}
              aria-pressed={!!sentiment}
              className={`flex items-center gap-1.5 rounded-full border-2 px-3.5 py-2 text-sm font-medium transition-all ${
                sentiment === "love"
                  ? "border-good bg-good-soft text-good"
                  : sentiment === "avoid"
                    ? "border-danger bg-danger-soft text-danger"
                    : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
              }`}
            >
              {sentiment === "love" && (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M12 21s-6.7-4.35-9.3-8.1C1.1 10.5 1.6 7.4 4 5.9c2-1.25 4.4-.7 5.7 1 .5.65.9 1.3 1 1.5.1-.2.5-.85 1-1.5 1.3-1.7 3.7-2.25 5.7-1 2.4 1.5 2.9 4.6 1.3 7-2.6 3.75-9.3 8.1-9.3 8.1z" />
                </svg>
              )}
              {sentiment === "avoid" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M6.5 6.5l11 11" />
                </svg>
              )}
              {code}
            </button>
          );
        })}
      </div>

      {cities.length === 0 && (
        <p className="mt-4 text-sm text-ink-faint">
          No layover cities to show yet &mdash; this step will be more useful once
          your bid pack has verified trip-by-trip data.
        </p>
      )}
    </div>
  );
}
