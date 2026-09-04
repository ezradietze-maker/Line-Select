"use client";

import { SelectableCard } from "@/components/ui/SelectableCard";
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
        {HOTEL_AMENITIES.map((amenity) => (
          <SelectableCard
            key={amenity.key}
            layout="list"
            label={amenity.label}
            description={amenity.description}
            selected={weights[amenity.key] > 0}
            onClick={() => onToggle(amenity.key)}
          />
        ))}
      </div>
    </div>
  );
}
