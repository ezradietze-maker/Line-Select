"use client";

import { useEffect, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { fetchHotel } from "@/lib/hotel-client";
import { buildTimelineDays, type TimelineDay } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";

const REPORT_LABELS: Record<Trip["reportTime"], string> = {
  early: "Early report",
  afternoon: "Afternoon report",
  evening: "Evening report",
};

const MINUTES_PER_DAY = 24 * 60;

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatHHMM(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-4 shrink-0 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function segmentClass(kind: TimelineDay["segments"][number]["kind"]): string {
  if (kind === "layover") return "bg-good";
  if (kind === "deadhead") {
    return "bg-brand/40 [background-image:repeating-linear-gradient(135deg,transparent,transparent_3px,rgba(255,255,255,0.35)_3px,rgba(255,255,255,0.35)_6px)]";
  }
  return "bg-brand";
}

function DayRow({ day }: { day: TimelineDay }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-11 shrink-0 text-right font-mono text-[10px] font-medium text-ink-faint">
        Day {day.dayNumber}
      </div>
      <div className="relative h-6 flex-1 overflow-hidden rounded bg-canvas">
        {[6, 12, 18].map((h) => (
          <div key={h} className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {day.segments.map((seg, i) => (
          <div
            key={i}
            title={`${seg.label} — ${seg.detail}`}
            className={`absolute top-0.5 bottom-0.5 ${segmentClass(seg.kind)} ${
              seg.continuesFromPreviousDay ? "" : "rounded-l-sm"
            } ${seg.continuesToNextDay ? "" : "rounded-r-sm"}`}
            style={{
              left: `${(seg.startMinuteOfDay / MINUTES_PER_DAY) * 100}%`,
              width: `${Math.max(0.6, ((seg.endMinuteOfDay - seg.startMinuteOfDay) / MINUTES_PER_DAY) * 100)}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** The visual "at a glance" schedule — day-by-day rows so a long international trip doesn't compress into one unreadable sliver. Real, printed clock times drive every segment's position; nothing here is estimated. */
function TripTimelineChart({ trip }: { trip: Trip }) {
  const days = buildTimelineDays(trip);
  if (days.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <LegendSwatch className="bg-brand" label="Flying" />
        <LegendSwatch className={segmentClass("deadhead")} label="Deadhead (riding along)" />
        <LegendSwatch className="bg-good" label="Layover / hotel" />
      </div>
      <div className="mt-3 space-y-1.5">
        {days.map((day) => (
          <DayRow key={day.dayNumber} day={day} />
        ))}
      </div>
      <div className="mt-1 flex justify-between pl-[3.25rem] font-mono text-[9px] text-ink-faint">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Green shows real time at the hotel, from block-in to next report — not exactly when
        you&rsquo;ll sleep, since that&rsquo;s down to you and the jet lag. Times shown are local
        to each station.
      </p>
    </div>
  );
}

interface ItineraryProps {
  trip: Trip;
  ratings: Record<string, HotelResult | null>;
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}

/** The precise, textual counterpart to the chart above — exact times, flight numbers, and hotel names for every leg and layover. */
function Itinerary({ trip, ratings, expandedKey, onToggleExpand }: ItineraryProps) {
  return (
    <div className="mt-4 space-y-2.5">
      {trip.schedule.map((duty, dutyIndex) => (
        <div key={dutyIndex} className="rounded-lg border border-border bg-canvas px-3 py-2.5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {dutyIndex === 0 ? "Report" : "Duty begins"} {formatHHMM(duty.reportTimeLocal)} local
          </div>
          <ul className="mt-1.5 space-y-1">
            {duty.legs.map((leg, legIndex) => (
              <li key={legIndex} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${leg.isDeadhead ? "bg-brand/45" : "bg-brand"}`}
                  aria-hidden
                />
                <span className="font-mono text-ink-muted">{formatHHMM(leg.depTimeLocal)}</span>
                <span className="text-ink">
                  {leg.depAirport} &rarr; {leg.arrAirport}
                </span>
                <span className="font-mono text-ink-muted">{formatHHMM(leg.arrTimeLocal)}</span>
                <span className="text-ink-faint">
                  &middot; {leg.flightNumber}
                  {leg.isDeadhead ? " (deadhead)" : ""}
                  {leg.blockHours !== null && ` · ${formatDuration(leg.blockHours)} block`}
                </span>
              </li>
            ))}
          </ul>

          {duty.layover && (
            <LayoverRow
              tripId={trip.id}
              dutyIndex={dutyIndex}
              city={duty.layover.city}
              hotelName={duty.layover.hotelName}
              hours={duty.layover.hours}
              ratings={ratings}
              expandedKey={expandedKey}
              onToggleExpand={onToggleExpand}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function LayoverRow({
  tripId,
  dutyIndex,
  city,
  hotelName,
  hours,
  ratings,
  expandedKey,
  onToggleExpand,
}: {
  tripId: string;
  dutyIndex: number;
  city: string;
  hotelName: string | null;
  hours: number;
  ratings: Record<string, HotelResult | null>;
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}) {
  const hotel = hotelName ? ratings[`${city}|${hotelName}`] : undefined;
  const detailKey = `${tripId}-${dutyIndex}`;
  const canExpand = !!hotel && hasHotelQualityDetails(hotel);
  const expanded = expandedKey === detailKey;

  const content = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" aria-hidden />
      <span className="text-ink">
        {city}
        {hotelName ? ` · ${hotelName}` : ""}
      </span>
      <span className="font-mono text-ink-faint">{formatDuration(hours)} at hotel</span>
      {hotel?.rating != null && (
        <span className="inline-flex items-center gap-0.5 text-accent">
          <StarIcon className="h-3 w-3 fill-current" />
          {hotel.rating.toFixed(1)}
        </span>
      )}
      {canExpand && (
        <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      )}
    </>
  );

  return (
    <div className="mt-2 border-t border-border pt-2">
      {canExpand ? (
        <button
          type="button"
          onClick={() => onToggleExpand(detailKey)}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs hover:text-ink"
          aria-expanded={expanded}
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">{content}</div>
      )}
      {expanded && hotel && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-3">
          <HotelQualityDetails hotel={hotel} />
        </div>
      )}
    </div>
  );
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

  function handleToggleExpand(key: string) {
    setExpandedKey((k) => (k === key ? null : key));
  }

  return (
    <ul className="divide-y divide-border">
      {trips.map((trip) => (
        <li key={trip.id} className="py-4 first:pt-0">
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

          {trip.schedule.length > 0 ? (
            <div className="mt-3">
              <TripTimelineChart trip={trip} />
              <Itinerary
                trip={trip}
                ratings={ratings}
                expandedKey={expandedKey}
                onToggleExpand={handleToggleExpand}
              />
            </div>
          ) : (
            trip.layoverDetails.some((d) => d.hotelName) && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[7.5rem] text-xs text-ink-muted">
                {trip.layoverDetails
                  .filter((d) => d.hotelName)
                  .map((layover, i) => {
                    const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                    const detailKey = `${trip.id}-fallback-${layover.city}-${i}`;
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
                        onClick={() => handleToggleExpand(detailKey)}
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
            )
          )}

          {trip.schedule.length === 0 &&
            trip.layoverDetails
              .filter((d) => d.hotelName)
              .map((layover, i) => {
                const detailKey = `${trip.id}-fallback-${layover.city}-${i}`;
                if (expandedKey !== detailKey) return null;
                const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                if (!hotel) return null;
                return (
                  <div key={detailKey} className="mt-2 ml-[7.5rem] rounded-lg border border-border bg-canvas p-3">
                    <HotelQualityDetails hotel={hotel} />
                  </div>
                );
              })}
        </li>
      ))}
    </ul>
  );
}
