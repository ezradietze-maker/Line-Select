"use client";

import { HOTEL_AMENITIES } from "@/lib/interview-config";
import type { PreferenceWeights } from "@/types/preferences";

interface HotelAmenitiesStepProps {
  weights: PreferenceWeights;
  onToggle: (key: "hotelFood" | "hotelGym" | "hotelGrocery") => void;
}

export function HotelAmenitiesStep({ weights, onToggle }: HotelAmenitiesStepProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink sm:text-2xl">
        Which of these actually matter to you at a layover hotel?
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Tap whichever ones you actually care about. Totally optional &mdash; leave them all unselected if none of these sway you.
      </p>

      <div className="mt-6 space-y-3">
        {HOTEL_AMENITIES.map((amenity) => {
          const selected = weights[amenity.key] > 0;
          return (
            <button
              key={amenity.key}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(amenity.key)}
              className={`relative flex w-full items-start gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                selected
                  ? "border-brand bg-brand-soft ring-2 ring-brand/25 ring-offset-2 ring-offset-canvas"
                  : "border-border bg-surface hover:border-border-strong hover:bg-canvas"
              }`}
            >
              <div
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  selected
                    ? "border-brand bg-brand text-white"
                    : "border-border-strong bg-surface text-transparent"
                }`}
                aria-hidden
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-ink">{amenity.label}</div>
                <div className="mt-1 text-sm text-ink-muted">{amenity.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
