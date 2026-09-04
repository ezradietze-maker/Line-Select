"use client";

import { useEffect, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { CircadianStars } from "@/components/results/CircadianStars";
import { TimeModeToggle } from "@/components/results/TimeModeToggle";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { computeCircadianAssessment } from "@/lib/circadian";
import { fetchHotel } from "@/lib/hotel-client";
import { loadTimeMode, saveTimeMode } from "@/lib/time-mode-storage";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { buildTimelineDays, type TimeMode, type TimelineDay } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";

const REPORT_LABELS: Record<Trip["reportTime"], string> = {
  early: "Early report",
  afternoon: "Afternoon report",
  evening: "Evening report",
};

const MINUTES_PER_DAY = 24 * 60;
/** Pixels per hour in the calendar grid — 24 * 13 = 312px tall, compact enough to keep a long trip's day columns from needing a huge scroll, tall enough that a 30-45min segment still gets a few readable pixels. */
const HOUR_HEIGHT_PX = 13;
const CALENDAR_HEIGHT_PX = HOUR_HEIGHT_PX * 24;
/** Hours labeled in the shared time gutter — every 3h reads cleanly without crowding 9px text. */
const GUTTER_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

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
 * Below these clipped-duration thresholds, a segment's block renders too
 * short for its city/time labels to read cleanly (there's no pixel height
 * to check at this layer — segments are positioned by percentage — so
 * duration is the real-world proxy for "will this block actually be tall
 * enough"). Below the threshold the label is dropped entirely rather than
 * left to overlap or spill; the full detail is still one hover away via
 * the segment's `title`. A flight leg needs room to stack a departure label
 * at its top edge and an arrival label at its bottom, so its threshold is
 * higher than a layover's single, centered label.
 */
const MIN_MINUTES_FOR_FLIGHT_LABELS = 150;
const MIN_MINUTES_FOR_LAYOVER_LABEL = 75;

function showsInlineText(seg: TimelineDay["segments"][number]): boolean {
  const duration = seg.endMinuteOfDay - seg.startMinuteOfDay;
  if (seg.kind === "flying" || seg.kind === "deadhead") return duration >= MIN_MINUTES_FOR_FLIGHT_LABELS;
  if (seg.kind === "layover") return duration >= MIN_MINUTES_FOR_LAYOVER_LABEL;
  return false;
}

/** Deadhead's block is a lighter, hatched tint of brand rather than a solid saturated color, so dark text reads better on it than the white used for the solid flying/layover blocks. */
function inlineTextClass(kind: TimelineDay["segments"][number]["kind"]): string {
  return kind === "deadhead" ? "text-ink" : "text-white";
}

/** "+1"/"-1" chip flagging a date-line crossing on the fragment that actually lands — hover/tap reads the same one-line explanation the toggle's spec asked for, via the same native-`title` tooltip convention every other segment on this chart already uses. */
function DateLineChip({ badge }: { badge: TimelineDay["segments"][number]["dateLineBadge"] }) {
  if (!badge) return null;
  return (
    <span
      title={badge.explanation}
      className="absolute -top-1.5 -right-1.5 z-10 rounded-full border border-warn/40 bg-warn-soft px-1 font-mono text-[8px] font-semibold leading-tight text-warn"
    >
      {badge.delta > 0 ? `+${badge.delta}d` : `${badge.delta}d`}
    </span>
  );
}

/**
 * One calendar day as a real vertical column — midnight at the top, midnight
 * at the bottom, exactly like a week view in any calendar app — instead of
 * the old left-to-right bar. `heightPx` is shared across every column in
 * the grid so every day lines up against the same hour gutter regardless of
 * how packed any single day is.
 */
function DayColumn({ day, heightPx }: { day: TimelineDay; heightPx: number }) {
  return (
    <div className="w-[4.5rem] shrink-0 sm:w-20">
      <div className="text-center font-mono text-[9px] font-medium text-brand">D{day.dayNumber}</div>
      <div className="relative mt-1 overflow-visible rounded-sm bg-canvas" style={{ height: heightPx }}>
        {GUTTER_HOURS.map((h) => (
          <div
            key={h}
            className="absolute inset-x-0 h-px bg-border/70"
            style={{ top: `${(h / 24) * 100}%` }}
            aria-hidden
          />
        ))}
        {day.segments.map((seg, i) => (
          <div
            key={i}
            title={
              SEGMENT_TOOLTIP_SUFFIX[seg.kind]
                ? `${seg.label} — ${seg.detail}\n${SEGMENT_TOOLTIP_SUFFIX[seg.kind]}`
                : `${seg.label} — ${seg.detail}`
            }
            className={`absolute inset-x-0 ${segmentClass(seg.kind)} ${
              seg.continuesFromPreviousDay ? "" : "rounded-t-sm"
            } ${seg.continuesToNextDay ? "" : "rounded-b-sm"}`}
            style={{
              top: `${(seg.startMinuteOfDay / MINUTES_PER_DAY) * 100}%`,
              height: `${Math.max(0.8, ((seg.endMinuteOfDay - seg.startMinuteOfDay) / MINUTES_PER_DAY) * 100)}%`,
            }}
          >
            <DateLineChip badge={seg.dateLineBadge} />
            {showsInlineText(seg) && (
              <div
                className={`flex h-full flex-col justify-between px-1 py-0.5 font-mono text-[8px] font-medium leading-tight ${inlineTextClass(seg.kind)}`}
              >
                {/* Stacked top/bottom (departure at the top edge, arrival at the bottom) rather than side by side — a tall, narrow column reads that direction naturally, the same way the segment itself flows top-to-bottom in time. */}
                <span className="truncate text-left">{seg.inlineStart}</span>
                {seg.inlineEnd && <span className="truncate text-right">{seg.inlineEnd}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {day.zuluRulerLabel && (
        <div
          className="mt-0.5 text-center font-mono text-[7px] leading-tight text-ink-faint"
          title="This local day's own boundaries, read in Zulu — always visible so you can cross-check without switching the toggle."
        >
          {day.zuluRulerLabel}
        </div>
      )}
    </div>
  );
}

/** The shared left-hand hour gutter every day column lines up against — the one piece of a real calendar's week view that only needs to be drawn once, not once per column. */
function HourGutter({ heightPx }: { heightPx: number }) {
  return (
    <div className="sticky left-0 z-10 w-6 shrink-0 bg-surface pr-1">
      <div className="h-[13px]" aria-hidden />
      <div className="relative mt-1" style={{ height: heightPx }}>
        {GUTTER_HOURS.map((h) => (
          <div
            key={h}
            className="absolute right-0 -translate-y-1/2 font-mono text-[8px] leading-none text-ink-faint"
            style={{ top: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, "0")}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The visual "at a glance" schedule — a real calendar week view: one column
 * per day, midnight-to-midnight top-to-bottom, so a long international trip
 * reads the way a pilot actually thinks about it ("day 3 starts with a long
 * layover, day 4 is the long leg home") instead of compressing into an
 * unreadable horizontal sliver. Real, printed clock times drive every
 * segment's position; nothing here is estimated. Deliberately dense: full
 * explanations live in tooltips rather than always-on caption text, so
 * several lines' schedules can stay on screen together. `mode` decides
 * whether day columns (and which clock reads as primary on each segment)
 * follow Zulu or local calendar days — see trip-timeline.ts for why those
 * aren't the same grid.
 */
function TripTimelineChart({ trip, mode }: { trip: Trip; mode: TimeMode }) {
  const days = buildTimelineDays(trip, mode);
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
      <div className="mt-1.5 flex overflow-x-auto pb-1">
        <HourGutter heightPx={CALENDAR_HEIGHT_PX} />
        <div className="flex gap-1 pl-1">
          {days.map((day) => (
            <DayColumn key={day.dayNumber} day={day} heightPx={CALENDAR_HEIGHT_PX} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ItineraryProps {
  trip: Trip;
  mode: TimeMode;
  ratings: Record<string, HotelResult | null>;
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}

/**
 * The precise, textual counterpart to the chart above — exact times, flight
 * numbers, and hotel names for every leg and layover. Primary clock follows
 * `mode`; the other system rides along in parentheses right next to it,
 * same as the chart's own tooltips — translating between the two is the
 * point, not picking a winner. Both always come from the bid pack's own
 * printed HHMM pair (`depTimeLocal`/`depTimeGmt`), never `leg.depTimeZulu` —
 * that field is anchored to an arbitrary reference instant purely for
 * internally-consistent day-math (see `Trip.zuluAnchor`), so its own clock
 * reading doesn't match the pack's real printed GMT time.
 */
function Itinerary({ trip, mode, ratings, expandedKey, onToggleExpand }: ItineraryProps) {
  return (
    <div className="mt-2 divide-y divide-border/60 border-t border-border/60 text-[11px]">
      {trip.schedule.map((duty, dutyIndex) => (
        <div key={dutyIndex}>
          {duty.legs.map((leg, legIndex) => {
            const depPrimary = mode === "zulu" ? formatHHMM(leg.depTimeGmt) : formatHHMM(leg.depTimeLocal);
            const depSecondary = mode === "zulu" ? formatHHMM(leg.depTimeLocal) : formatHHMM(leg.depTimeGmt);
            const arrPrimary = mode === "zulu" ? formatHHMM(leg.arrTimeGmt) : formatHHMM(leg.arrTimeLocal);
            const arrSecondary = mode === "zulu" ? formatHHMM(leg.arrTimeLocal) : formatHHMM(leg.arrTimeGmt);
            return (
              <div key={legIndex} className="flex flex-wrap items-center gap-x-1.5 py-1">
                <span
                  className={`h-1 w-1 shrink-0 rounded-full ${leg.isDeadhead ? "bg-brand/45" : "bg-brand"}`}
                  aria-hidden
                />
                <span className="font-mono text-brand">
                  {depPrimary} <span className="text-ink-faint">({depSecondary})</span>
                </span>
                <span className="text-ink">
                  {leg.depAirport}&rarr;{leg.arrAirport}
                </span>
                <span className="font-mono text-brand">
                  {arrPrimary} <span className="text-ink-faint">({arrSecondary})</span>
                </span>
                <span className="text-brand/70">
                  {leg.flightNumber}
                  {leg.isDeadhead ? " DH" : ""}
                  {leg.blockHours !== null && ` · ${formatDuration(leg.blockHours)}`}
                </span>
              </div>
            );
          })}

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
  // Starts at the same fixed default the server renders (matching
  // ThemeToggle's approach), then syncs to the pilot's real stored choice
  // once mounted — a lazy initializer reading localStorage directly here
  // would mismatch whatever the server rendered and trip a hydration
  // warning the first time a pilot had actually chosen "zulu" before.
  const [mode, setMode] = useState<TimeMode>("local");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(loadTimeMode());
  }, []);

  function handleModeChange(next: TimeMode) {
    setMode(next);
    saveTimeMode(next);
  }

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
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <TimeModeToggle mode={mode} onChange={handleModeChange} />
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
              <TripTimelineChart trip={trip} mode={mode} />
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
                  mode={mode}
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
