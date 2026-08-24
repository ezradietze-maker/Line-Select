"use client";

import { useEffect, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { fetchHotel } from "@/lib/hotel-client";
import type { Trip } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";

const REPORT_LABELS: Record<Trip["reportTime"], string> = {
  early: "Early report",
  afternoon: "Afternoon report",
  evening: "Evening report",
};

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

interface TripListProps {
  trips: Trip[];
}

export function TripList({ trips }: TripListProps) {
  const [ratings, setRatings] = useState<Record<string, HotelResult | null>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    const pairs = new Map<string, { code: string; hotelName: string }>();
    for (const trip of trips) {
      for (const layover of trip.layoverDetails) {
        if (!layover.hotelName) continue;
        pairs.set(`${layover.city}|${layover.hotelName}`, { code: layover.city, hotelName: layover.hotelName });
      }
    }
    if (pairs.size === 0) return;

    let cancelled = false;
    Promise.all(
      Array.from(pairs.entries()).map(async ([key, { code, hotelName }]) => {
        const result = await fetchHotel(code, hotelName);
        return [key, result.hotel] as const;
      })
    ).then((entries) => {
      if (!cancelled) setRatings(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [trips]);

  return (
    <ul className="divide-y divide-border">
      {trips.map((trip) => (
        <li key={trip.id} className="py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <div className="flex min-w-[7rem] items-baseline gap-1.5">
              <span className="font-mono text-sm font-semibold text-ink">{trip.days}-day</span>
              {trip.international && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Intl
                </span>
              )}
            </div>

            <div className="flex-1 text-sm text-ink">{trip.layoverCities.join(" → ")}</div>

            <div className="text-xs text-ink-muted">{REPORT_LABELS[trip.reportTime]}</div>

            <div className="font-mono text-xs text-ink-muted">{formatHours(trip.creditHours)} credit</div>

            <div className="font-mono text-xs text-ink-faint">
              {trip.deadheadLegs > 0
                ? `${trip.deadheadLegs} deadhead leg${trip.deadheadLegs > 1 ? "s" : ""}`
                : "no deadhead"}
            </div>
          </div>

          {trip.layoverDetails.some((d) => d.hotelName) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[7.5rem] text-xs text-ink-muted">
              {trip.layoverDetails
                .filter((d) => d.hotelName)
                .map((layover, i) => {
                  const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                  const detailKey = `${trip.id}-${layover.city}-${i}`;
                  const canExpand = !!hotel && hasHotelQualityDetails(hotel);
                  const content = (
                    <>
                      <span className="font-medium text-ink-faint">{layover.city}:</span>
                      {layover.hotelName}
                      {hotel?.rating != null && (
                        <span className="inline-flex items-center gap-0.5 text-accent">
                          <StarIcon className="h-3 w-3 fill-current" />
                          {hotel.rating.toFixed(1)}
                        </span>
                      )}
                      {canExpand && (
                        <ChevronDownIcon
                          className={`h-3 w-3 shrink-0 transition-transform ${
                            expandedKey === detailKey ? "rotate-180" : ""
                          }`}
                        />
                      )}
                    </>
                  );
                  return canExpand ? (
                    <button
                      key={detailKey}
                      type="button"
                      onClick={() => setExpandedKey((k) => (k === detailKey ? null : detailKey))}
                      className="inline-flex items-center gap-1 hover:text-ink"
                      aria-expanded={expandedKey === detailKey}
                    >
                      {content}
                    </button>
                  ) : (
                    <span key={detailKey} className="inline-flex items-center gap-1">
                      {content}
                    </span>
                  );
                })}
            </div>
          )}

          {trip.layoverDetails
            .filter((d) => d.hotelName)
            .map((layover, i) => {
              const detailKey = `${trip.id}-${layover.city}-${i}`;
              if (expandedKey !== detailKey) return null;
              const hotel = ratings[`${layover.city}|${layover.hotelName}`];
              if (!hotel) return null;
              return (
                <div
                  key={detailKey}
                  className="mt-2 ml-[7.5rem] rounded-lg border border-border bg-canvas p-3"
                >
                  <HotelQualityDetails hotel={hotel} />
                </div>
              );
            })}
        </li>
      ))}
    </ul>
  );
}
