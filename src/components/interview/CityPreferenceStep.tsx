"use client";

import { CityChips } from "@/components/preferences/CityChips";
import { Heading } from "@/components/ui/Heading";
import type { CitySentiment } from "@/types/preferences";

interface CityPreferenceStepProps {
  /** Every layover city in the pack, most-visited first. */
  cities: string[];
  preferences: Record<string, CitySentiment>;
  /** Cycles one city through favorite -> avoid -> no opinion. The caller
   * applies this against the latest state (a functional setState update),
   * not the `preferences` snapshot passed in as a prop — otherwise two
   * taps landing before a re-render (a fast double-tap, common on mobile)
   * would both read the same stale value and the second tap would be lost. */
  onToggleCity: (code: string) => void;
}

export function CityPreferenceStep({ cities, preferences, onToggleCity }: CityPreferenceStepProps) {
  return (
    <div>
      <Heading as="h2" className="text-xl text-ink sm:text-2xl">
        Any layover cities you love or want to avoid?
      </Heading>
      <p className="mt-1.5 text-sm text-ink-muted">
        These are all {cities.length} layover cities in your bid pack, most-flown first. Totally optional &mdash; skip
        anything you don&rsquo;t have a feeling about.
      </p>

      <div className="mt-6">
        <CityChips cities={cities} sentiments={preferences} onCycle={onToggleCity} />
      </div>

      {cities.length === 0 && (
        <p className="mt-4 text-sm text-ink-faint">
          No layover cities to show yet &mdash; this step will be more useful once your bid pack has verified
          trip-by-trip data.
        </p>
      )}
    </div>
  );
}
