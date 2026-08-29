"use client";

import { useEffect, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { CircadianStars } from "@/components/results/CircadianStars";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { computeCircadianAssessment } from "@/lib/circadian";
import { fetchHotel } from "@/lib/hotel-client";
import { computeTripAnalytics } from "@/lib/trip-analytics";
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

const LAYOVER_TOOLTIP =
  "Layover / hotel — real time from block-in to hotel pickup for the next departure. Not exactly when you'll sleep, since that's down to you and the jet lag.";

const GROUND_TOOLTIP =
  "On the ground before departure — report/check-in at trip start, or hotel-to-airport transport plus check-in after a layover. Not split further since the bid pack doesn't print a separate drop-off time.";

const CONNECTION_TOOLTIP =
  "Ground time between two flights in the same duty period — too short to be a layover, just deplane, walk, and board the next one.";

function LegendSwatch({ className, label, title }: { className: string; label: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`h-2 w-3 shrink-0 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function segmentClass(kind: TimelineDay["segments"][number]["kind"]): string {
  if (kind === "layover") return "bg-good";
  if (kind === "ground") return "bg-accent";
  if (kind === "connection") return "bg-border-strong";
  if (kind === "deadhead") {
    return "bg-brand/40 [background-image:repeating-linear-gradient(135deg,transparent,transparent_3px,rgba(255,255,255,0.35)_3px,rgba(255,255,255,0.35)_6px)]";
  }
  return "bg-brand";
}

const SEGMENT_TOOLTIP_SUFFIX: Partial<Record<TimelineDay["segments"][number]["kind"], string>> = {
  layover: LAYOVER_TOOLTIP,
  ground: GROUND_TOOLTIP,
  connection: CONNECTION_TOOLTIP,
};

/**
 * Below these clipped-duration thresholds, a segment's bar renders too
 * narrow for its city/time labels to read cleanly (there's no pixel width
 * to check at this layer — segments are positioned by percentage — so
 * duration is the real-world proxy for "will this bar actually be wide
 * enough"). Below the threshold the label is dropped entirely rather than
 * left to overlap or spill; the full detail is still one hover away via
 * the segment's `title`. Flight legs need room for two labels (departure
 * and arrival) sharing one bar, so their threshold is higher than a
 * layover's single, centered label.
 */
const MIN_MINUTES_FOR_FLIGHT_LABELS = 210;
const MIN_MINUTES_FOR_LAYOVER_LABEL = 90;

function showsInlineText(seg: TimelineDay["segments"][number]): boolean {
  const duration = seg.endMinuteOfDay - seg.startMinuteOfDay;
  if (seg.kind === "flying" || seg.kind === "deadhead") return duration >= MIN_MINUTES_FOR_FLIGHT_LABELS;
  if (seg.kind === "layover") return duration >= MIN_MINUTES_FOR_LAYOVER_LABEL;
  return false;
}

/** Deadhead's bar is a lighter, hatched tint of brand rather than a solid saturated color, so dark text reads better on it than the white used for the solid flying/layover bars. */
function inlineTextClass(kind: TimelineDay["segments"][number]["kind"]): string {
  return kind === "deadhead" ? "text-ink" : "text-white";
}

function DayRow({ day }: { day: TimelineDay }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-8 shrink-0 text-right font-mono text-[9px] font-medium text-brand">
        D{day.dayNumber}
      </div>
      <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-canvas">
        {[6, 12, 18].map((h) => (
          <div key={h} className="absolute top-0 bottom-0 w-px bg-border/70" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {day.segments.map((seg, i) => (
          <div
            key={i}
            title={
              SEGMENT_TOOLTIP_SUFFIX[seg.kind]
                ? `${seg.label} — ${seg.detail}\n${SEGMENT_TOOLTIP_SUFFIX[seg.kind]}`
                : `${seg.label} — ${seg.detail}`
            }
            className={`absolute top-0 bottom-0 ${segmentClass(seg.kind)} ${
              seg.continuesFromPreviousDay ? "" : "rounded-l-sm"
            } ${seg.continuesToNextDay ? "" : "rounded-r-sm"}`}
            style={{
              left: `${(seg.startMinuteOfDay / MINUTES_PER_DAY) * 100}%`,
              width: `${Math.max(0.6, ((seg.endMinuteOfDay - seg.startMinuteOfDay) / MINUTES_PER_DAY) * 100)}%`,
            }}
          >
            {showsInlineText(seg) && (
              <div
                className={`flex h-full items-center gap-1 px-1 font-mono text-[8px] font-medium leading-none ${inlineTextClass(seg.kind)}`}
              >
                {/* `flex-1` gives each label a fixed half-width share of the bar (rather than its natural text width), so `truncate` has an actual boundary to ellipsize against — without it, two long labels in a narrow bar would overlap instead of cleanly cutting off. */}
                <span className="min-w-0 flex-1 truncate text-left">{seg.inlineStart}</span>
                {seg.inlineEnd && <span className="min-w-0 flex-1 truncate text-right">{seg.inlineEnd}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The visual "at a glance" schedule — day-by-day rows so a long international trip doesn't compress into one unreadable sliver. Real, printed clock times drive every segment's position; nothing here is estimated. Deliberately dense: full explanations live in tooltips rather than always-on caption text, so several lines' schedules can stay on screen together. */
function TripTimelineChart({ trip }: { trip: Trip }) {
  const days = buildTimelineDays(trip);
  if (days.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-medium text-brand">
        <LegendSwatch className="bg-brand" label="Flying" />
        <LegendSwatch className={segmentClass("deadhead")} label="Deadhead" title="Riding along, not operating" />
        <LegendSwatch className="bg-good" label="Layover" title={LAYOVER_TOOLTIP} />
        <LegendSwatch className="bg-accent" label="Ground" title={GROUND_TOOLTIP} />
        <LegendSwatch className="bg-border-strong" label="Connection" title={CONNECTION_TOOLTIP} />
      </div>
      <div className="mt-1.5 flex justify-between pl-[2.375rem] font-mono text-[8px] leading-none text-brand/70">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24h</span>
      </div>
      <div className="mt-0.5 space-y-1">
        {days.map((day) => (
          <DayRow key={day.dayNumber} day={day} />
        ))}
      </div>
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
    <div className="mt-2 divide-y divide-border/60 border-t border-border/60 text-[11px]">
      {trip.schedule.map((duty, dutyIndex) => (
        <div key={dutyIndex}>
          {duty.legs.map((leg, legIndex) => (
            <div key={legIndex} className="flex flex-wrap items-center gap-x-1.5 py-1">
              <span
                className={`h-1 w-1 shrink-0 rounded-full ${leg.isDeadhead ? "bg-brand/45" : "bg-brand"}`}
                aria-hidden
              />
              <span className="font-mono text-brand">{formatHHMM(leg.depTimeLocal)}</span>
              <span className="text-ink">
                {leg.depAirport}&rarr;{leg.arrAirport}
              </span>
              <span className="font-mono text-brand">{formatHHMM(leg.arrTimeLocal)}</span>
              <span className="text-brand/70">
                {leg.flightNumber}
                {leg.isDeadhead ? " DH" : ""}
                {leg.blockHours !== null && ` · ${formatDuration(leg.blockHours)}`}
              </span>
            </div>
          ))}

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
      <span className="h-1 w-1 shrink-0 rounded-full bg-good" aria-hidden />
      <span className="text-ink">
        {city}
        {hotelName ? ` · ${hotelName}` : ""}
      </span>
      <span className="font-mono text-brand/70">{formatDuration(hours)}</span>
      {hotel?.rating != null && (
        <span className="inline-flex items-center gap-0.5 text-accent">
          <StarIcon className="h-2.5 w-2.5 fill-current" />
          {hotel.rating.toFixed(1)}
        </span>
      )}
      {canExpand && (
        <ChevronDownIcon className={`h-2.5 w-2.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      )}
    </>
  );

  return (
    <div className="py-1">
      {canExpand ? (
        <button
          type="button"
          onClick={() => onToggleExpand(detailKey)}
          className="flex flex-wrap items-center gap-x-1.5 hover:text-ink"
          aria-expanded={expanded}
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-x-1.5">{content}</div>
      )}
      {expanded && hotel && (
        <div className="mt-1.5 rounded-lg border border-border bg-surface p-2.5">
          <HotelQualityDetails hotel={hotel} />
        </div>
      )}
    </div>
  );
}

interface InsightChip {
  label: string;
  value: string;
  title: string;
  tone?: "warn";
}

/**
 * A compact read of `computeTripAnalytics` — real per-leg arithmetic
 * already computed for scoring/strategies but never surfaced to a pilot
 * directly until now. Each chip only appears when its underlying field is
 * non-null (some trips predate GMT-pair data or lack a verified schedule)
 * and clears a "worth mentioning" bar, so a plain, unremarkable trip shows
 * nothing rather than a row of zeros.
 */
function TripInsights({ trip }: { trip: Trip }) {
  const a = computeTripAnalytics(trip);
  const chips: InsightChip[] = [];

  if (a.creditPerTafbHour !== null) {
    chips.push({
      label: "Day-rig rate",
      value: `${(a.creditPerTafbHour * 24).toFixed(1)} hrs/day`,
      title:
        "Credit hours earned per 24 hours away from base — this trip's own pay-per-day-away rate, independent of how long the trip runs.",
    });
  }

  if (a.totalTimezoneCrossingMinutes !== null && a.totalTimezoneCrossingMinutes >= 60) {
    const netHours = (a.netTimezoneMinutes ?? 0) / 60;
    const direction = netHours > 0.5 ? "eastbound" : netHours < -0.5 ? "westbound" : "round-trip";
    chips.push({
      label: "Timezone crossing",
      value: `${(a.totalTimezoneCrossingMinutes / 60).toFixed(1)}h total, ${direction}`,
      title:
        "Total time-zone distance crossed across every leg (both directions added together), and which way the trip nets out overall.",
    });
  }

  if (a.avgSleepOpportunityHours !== null) {
    chips.push({
      label: "Avg sleep opportunity",
      value: `${a.avgSleepOpportunityHours.toFixed(1)}h`,
      title:
        "Layover time minus the real hotel-pickup/ground gap around it — closer to actual usable rest than the printed layover duration.",
    });
  }

  if (a.dutyToBlockRatio !== null && a.dutyToBlockRatio >= 1.1) {
    chips.push({
      label: "Duty-to-flying ratio",
      value: `${a.dutyToBlockRatio.toFixed(1)}×`,
      title:
        "Total duty time divided by actual block time — higher means more of the day is ground time and connections than real flying.",
    });
  }

  if (a.backToBackRedEyeDuties > 0) {
    chips.push({
      label: "Back-to-back red-eyes",
      value: String(a.backToBackRedEyeDuties),
      tone: "warn",
      title:
        "Consecutive duty periods that each include a red-eye (00:00-05:00 local) departure or arrival — compounding fatigue risk rather than one bad night followed by recovery.",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[7.5rem] text-[11px]">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className={`inline-flex items-center gap-1 ${chip.tone === "warn" ? "text-warn" : "text-ink-faint"}`}
        >
          <span className="font-medium">{chip.label}:</span> {chip.value}
        </span>
      ))}
    </div>
  );
}

interface TripListProps {
  trips: Trip[];
  /** Real UTC offset derived from the bid pack's own printed times — see lib/circadian.ts. Null when it couldn't be derived. */
  homeBaseOffsetMinutes: number | null;
}

export function TripList({ trips, homeBaseOffsetMinutes }: TripListProps) {
  const [ratings, setRatings] = useState<Record<string, HotelResult | null>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openItineraries, setOpenItineraries] = useState<Set<string>>(new Set());

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

  function toggleItinerary(tripId: string) {
    setOpenItineraries((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex justify-end">
        <CircadianInfo />
      </div>
      <ul className="divide-y divide-border">
      {trips.map((trip, tripIndex) => {
        const circadian = computeCircadianAssessment(trip, homeBaseOffsetMinutes);
        return (
        // `trip.id` alone isn't unique — the same short pairing flown
        // several times in one month legitimately appears more than once
        // in this line's `trips` array.
        <li key={`${trip.id}-${tripIndex}`} className="py-2.5 first:pt-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <div className="flex min-w-[7rem] items-baseline gap-1.5">
              <span className="font-mono text-sm font-semibold text-ink">{trip.days}-day</span>
              {trip.international && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Intl
                </span>
              )}
              <CircadianStars assessment={circadian} size="sm" />
            </div>

            <div className="flex-1 text-sm text-ink">{trip.layoverCities.join(" → ")}</div>

            <div className="text-xs text-brand">{REPORT_LABELS[trip.reportTime]}</div>

            <div className="font-mono text-xs text-brand">{formatHours(trip.creditHours)} credit</div>

            <div className="font-mono text-xs text-brand/70">
              {trip.deadheadLegs > 0
                ? `${trip.deadheadLegs} deadhead leg${trip.deadheadLegs > 1 ? "s" : ""}`
                : "no deadhead"}
            </div>
          </div>

          <TripInsights trip={trip} />

          {trip.schedule.length > 0 ? (
            <div className="mt-2">
              <TripTimelineChart trip={trip} />
              <button
                type="button"
                onClick={() => toggleItinerary(trip.id)}
                className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-brand hover:text-ink"
                aria-expanded={openItineraries.has(trip.id)}
              >
                {openItineraries.has(trip.id) ? "Hide" : "Show"} flight-by-flight itinerary
                <ChevronDownIcon
                  className={`h-2.5 w-2.5 shrink-0 transition-transform ${
                    openItineraries.has(trip.id) ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openItineraries.has(trip.id) && (
                <Itinerary
                  trip={trip}
                  ratings={ratings}
                  expandedKey={expandedKey}
                  onToggleExpand={handleToggleExpand}
                />
              )}
            </div>
          ) : (
            trip.layoverDetails.some((d) => d.hotelName) && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[7.5rem] text-xs text-brand">
                {trip.layoverDetails
                  .filter((d) => d.hotelName)
                  .map((layover, i) => {
                    const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                    const detailKey = `${trip.id}-fallback-${layover.city}-${i}`;
                    const canExpand = !!hotel && hasHotelQualityDetails(hotel);
                    const content = (
                      <>
                        <span className="font-medium text-brand">{layover.city}:</span>
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
        );
      })}
      </ul>
    </div>
  );
}
