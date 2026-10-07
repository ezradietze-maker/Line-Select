"use client";

import { Fragment, useEffect, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { CircadianStars } from "@/components/results/CircadianStars";
import { TimeModeToggle } from "@/components/results/TimeModeToggle";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { computeCircadianAssessment } from "@/lib/circadian";
import { tripDutyPeriods } from "@/lib/duty-periods";
import { fetchHotel } from "@/lib/hotel-client";
import { loadTimeMode, saveTimeMode } from "@/lib/time-mode-storage";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { clock, dayStats, equipmentLabel, hm, tripBlockMinutes, tripDayDate, tripRoute, type DayStats } from "@/lib/trip-day-stats";
import { buildTimelineDays, type TimeMode, type TimelineDay, type TimelineSegment } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";
import type { CitySentiment } from "@/types/preferences";

const REPORT_LABELS: Record<Trip["reportTime"], string> = {
  early: "Early",
  afternoon: "Afternoon",
  evening: "Evening",
};

const MINUTES_PER_DAY = 24 * 60;
/** Pixels per hour in the calendar grid — 24 * 13 = 312px tall, compact enough to keep a long trip's day columns from needing a huge scroll, tall enough that a 30-45min segment still gets a few readable pixels. */
const HOUR_HEIGHT_PX = 13;
const CALENDAR_HEIGHT_PX = HOUR_HEIGHT_PX * 24;
/** Height of each day column's header (date + that day's duty numbers) — shared with the hour gutter's spacer so the hours line up. */
const DAY_HEADER_PX = 46;
/** Hours labeled in the shared time gutter — every 3h reads cleanly without crowding 9px text. */
const GUTTER_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
/** The body clock's low point, as the circadian score and early-report flag define it (see `circadian.ts`). */
const WOCL_START = 2 * 60;
const WOCL_END = 6 * 60;

const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint";

function formatHHMM(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

const LAYOVER_TOOLTIP =
  "Layover / hotel — real time from block-in to hotel pickup for the next departure. Not exactly when you'll sleep, since that's down to you and the jet lag.";

const STANDBY_TOOLTIP =
  "Hotel standby — you sit on call at the layover hotel for the day. It pays the guaranteed standby credit, but no flight is flown unless you're called out.";

const GROUND_TOOLTIP =
  "On the ground before departure — report/check-in at trip start, or hotel-to-airport transport plus check-in after a layover. Not split further since the bid pack doesn't print a separate drop-off time.";

const CONNECTION_TOOLTIP =
  "Ground time between two flights in the same duty period — too short to be a layover, just deplane, walk, and board the next one.";

const WOCL_TOOLTIP = "02:00–06:00 local — the window your body clock is at its lowest. Flying or reporting inside it is what the circadian stars weigh most.";

function LegendSwatch({ className, label, title }: { className: string; label: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`h-2.5 w-3.5 shrink-0 rounded-[3px] ${className}`} />
      {label}
    </span>
  );
}

/**
 * Every segment kind in the site's own palette: flying is the calendar's
 * solid color (the one a pilot can personalize), a deadhead the same color
 * hatched, hotel time a quiet green wash with a green edge, standby the same
 * in violet, and ground time a thin amber band — so a day reads as "the
 * flying" first and everything else second.
 */
function segmentClass(kind: TimelineSegment["kind"]): string {
  switch (kind) {
    case "flying":
      return "bg-calendar-accent text-on-calendar shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]";
    case "deadhead":
      return "hatch-deadhead bg-calendar-accent/15 text-ink ring-1 ring-inset ring-calendar-accent/50";
    case "layover":
      return "bg-good/15 text-ink border-l-2 border-good";
    case "standby":
      return "bg-standby/20 text-ink border-l-2 border-standby";
    case "ground":
      return "bg-accent/55";
    case "connection":
      return "bg-border-strong/50";
  }
}

const SEGMENT_TOOLTIP_SUFFIX: Partial<Record<TimelineSegment["kind"], string>> = {
  layover: LAYOVER_TOOLTIP,
  ground: GROUND_TOOLTIP,
  connection: CONNECTION_TOOLTIP,
  standby: STANDBY_TOOLTIP,
};

/** A segment's drawn length on its day; a fragment whose clock end reads earlier than its start runs to midnight. */
function spanMinutes(seg: TimelineSegment): number {
  const end = seg.endMinuteOfDay < seg.startMinuteOfDay ? MINUTES_PER_DAY : seg.endMinuteOfDay;
  return end - seg.startMinuteOfDay;
}

/** "+1"/"-1" chip flagging a date-line crossing on the fragment that actually lands — hover/tap reads the one-line explanation. */
function DateLineChip({ badge }: { badge: TimelineSegment["dateLineBadge"] }) {
  if (!badge) return null;
  return (
    <span
      title={badge.explanation}
      className="absolute -top-1.5 -right-1 z-10 rounded-full border border-warn/40 bg-warn-soft px-1 font-mono text-[10px] font-semibold leading-tight text-warn"
    >
      {badge.delta > 0 ? `+${badge.delta}d` : `${badge.delta}d`}
    </span>
  );
}

function Sentiment({ sentiment }: { sentiment: CitySentiment | null | undefined }) {
  if (sentiment === "love") return <span className="text-good" aria-label="a city you love">♥</span>;
  if (sentiment === "avoid") return <span className="text-danger" aria-label="a city you avoid">✕</span>;
  return null;
}

/**
 * What prints on a segment, as much as its height carries. A flight of a
 * couple of hours gets its departure at the top edge, arrival at the bottom
 * and the flight number and block time between; a short hop gets its route
 * on one line. A hotel stay gets its city and rest, then the hotel, then the
 * pickup time on the day it ends. Lines that don't fit are dropped, never
 * squeezed — the full detail is always in the segment's tooltip and the
 * itinerary below.
 */
function SegmentText({ seg, cityPreferences }: { seg: TimelineSegment; cityPreferences?: Record<string, CitySentiment> }) {
  const minutes = spanMinutes(seg);
  const lines = Math.floor((minutes / 60) * HOUR_HEIGHT_PX / 12);
  if (lines < 1) return null;

  if ((seg.kind === "flying" || seg.kind === "deadhead") && seg.leg) {
    const leg = seg.leg;
    const dep = seg.continuesFromPreviousDay ? null : `${leg.depClock} ${leg.dep}`;
    const arr = seg.continuesToNextDay ? null : `${leg.arr} ${leg.arrClock}`;
    const route = `${leg.deadhead ? "DH " : ""}${leg.dep}–${leg.arr}`;
    const middle = `${leg.flightNumber}${leg.blockMinutes !== null ? ` · ${hm(leg.blockMinutes)}` : ""}`;
    let rows: (string | null)[];
    if (lines >= 3) rows = [dep ?? route, middle, arr];
    else if (lines === 2) rows = dep && arr ? [dep, arr] : [dep ?? route, arr ?? middle];
    else rows = [route];
    return (
      <div className="flex h-full flex-col justify-between overflow-hidden px-1 py-px font-mono text-[10px] font-medium leading-[12px]">
        {rows.map((r, i) => (
          <span key={i} className={`truncate ${i === rows.length - 1 && rows.length > 1 ? "text-right" : ""} ${i === 1 && rows.length === 3 ? "opacity-75" : ""}`}>
            {r ?? ""}
          </span>
        ))}
      </div>
    );
  }

  if (seg.kind === "layover" && seg.stay) {
    const stay = seg.stay;
    const head = seg.continuesFromPreviousDay ? `${stay.city} rest` : `${stay.city} · ${formatDuration(stay.hours)}`;
    const pickup = seg.continuesToNextDay ? null : `pickup ${stay.pickupClock ?? clock(seg.endMinuteOfDay)}`;
    const rows: { text: string; tone: string }[] = [{ text: head, tone: "font-semibold" }];
    if (stay.hotel && lines >= 3) rows.push({ text: stay.hotel.toLowerCase(), tone: "capitalize text-ink-muted" });
    if (pickup && lines >= 2) rows.push({ text: pickup, tone: "text-ink-muted" });
    return (
      <div className="flex h-full flex-col justify-between overflow-hidden px-1 py-px font-mono text-[10px] leading-[12px]">
        <span className={`flex min-w-0 items-center gap-0.5 ${rows[0].tone}`}>
          <span className="truncate">{rows[0].text}</span>
          <Sentiment sentiment={cityPreferences?.[stay.city]} />
        </span>
        {rows.length > 2 && <span className={`truncate font-sans text-[10px] ${rows[1].tone}`}>{rows[1].text}</span>}
        {rows.length > 1 && <span className={`truncate ${rows[rows.length - 1].tone}`}>{rows[rows.length - 1].text}</span>}
      </div>
    );
  }

  if (seg.kind === "connection" && seg.stay) {
    return (
      <div className="flex h-full flex-col justify-between overflow-hidden px-1 py-px font-mono text-[10px] leading-[12px]">
        <span className="truncate font-semibold">{seg.stay.city} day room</span>
        {lines >= 2 && <span className="truncate font-sans capitalize text-ink-muted">{seg.stay.hotel?.toLowerCase()}</span>}
      </div>
    );
  }

  if (seg.kind === "standby") {
    return (
      <div className="flex h-full flex-col justify-between overflow-hidden px-1 py-px font-mono text-[10px] font-medium leading-[12px] text-standby">
        <span className="truncate">{seg.inlineStart || "Standby"}</span>
        {lines >= 2 && !seg.continuesToNextDay && <span className="truncate text-ink-muted">until {clock(seg.endMinuteOfDay)}</span>}
      </div>
    );
  }

  return null;
}

/** The two-line read of one day above its column: when it starts and ends, and how much of it is flying. */
function DayHeader({ day, stats, date }: { day: TimelineDay; stats: DayStats; date: { weekday: string; day: number } | null }) {
  const window =
    stats.onDuty || stats.dutyEnd
      ? `${stats.onDuty ?? (stats.continuesIn ? "··" : "")}–${stats.dutyEnd ?? (stats.continuesOut ? "··" : "")}`
      : stats.restDay
        ? "rest day"
        : stats.continuesIn || stats.continuesOut
          ? "in flight"
          : "—";
  const work =
    stats.blockMinutes > 0
      ? `${hm(stats.blockMinutes)} blk · ${stats.landings} ldg`
      : stats.standby
        ? "hotel standby"
        : stats.deadheadMinutes > 0
          ? `DH ${hm(stats.deadheadMinutes)}`
          : stats.restDay
            ? "no duty"
            : "";
  const isWeekend = date?.weekday === "Sat" || date?.weekday === "Sun";
  return (
    <div className="flex flex-col justify-between rounded-t-md border border-b-0 border-hairline bg-surface-raised/70 px-1 py-1" style={{ height: DAY_HEADER_PX }}>
      <div className="flex items-baseline justify-between gap-1 font-mono text-[10px] leading-none">
        <span className="font-semibold text-readout">D{day.dayNumber}</span>
        {date && (
          <span className={isWeekend ? "text-accent" : "text-ink-muted"}>
            {date.weekday} {date.day}
          </span>
        )}
      </div>
      <div className={`truncate font-mono text-[10px] leading-none ${stats.restDay ? "text-good" : "text-ink"}`}>{window}</div>
      <div className={`truncate font-mono text-[10px] leading-none ${stats.standby ? "text-standby" : "text-ink-faint"}`}>{work}</div>
    </div>
  );
}

/**
 * One calendar day as a real vertical column — midnight at the top, midnight
 * at the bottom, exactly like a week view in any calendar app. Columns share
 * the panel's width, so a short trip gets wide columns with every label on
 * them and a long one stays on screen with the essentials.
 */
function DayColumn({
  day,
  mode,
  date,
  cityPreferences,
}: {
  day: TimelineDay;
  mode: TimeMode;
  date: { weekday: string; day: number } | null;
  cityPreferences?: Record<string, CitySentiment>;
}) {
  const stats = dayStats(day);
  return (
    <div className="min-w-[6.75rem] max-w-[13rem] flex-1 basis-0 sm:min-w-[5.75rem]">
      <DayHeader day={day} stats={stats} date={date} />
      <div className="relative overflow-hidden rounded-b-md border border-hairline bg-canvas/70" style={{ height: CALENDAR_HEIGHT_PX }}>
        {mode === "local" && (
          <div
            className="absolute inset-x-0 bg-ink/[0.05]"
            style={{ top: `${(WOCL_START / MINUTES_PER_DAY) * 100}%`, height: `${((WOCL_END - WOCL_START) / MINUTES_PER_DAY) * 100}%` }}
            title={WOCL_TOOLTIP}
            aria-hidden
          />
        )}
        {GUTTER_HOURS.slice(1).map((h) => (
          <div key={h} className={`absolute inset-x-0 h-px ${h === 12 ? "bg-border-strong/40" : "bg-hairline"}`} style={{ top: `${(h / 24) * 100}%` }} aria-hidden />
        ))}
        {day.segments.map((seg, i) => (
          <div
            key={i}
            title={SEGMENT_TOOLTIP_SUFFIX[seg.kind] ? `${seg.label} — ${seg.detail}\n${SEGMENT_TOOLTIP_SUFFIX[seg.kind]}` : `${seg.label} — ${seg.detail}`}
            className={`absolute inset-x-0.5 ${seg.kind === "connection" && seg.stay ? "border-l-2 border-good/70 bg-good/10 text-ink" : segmentClass(seg.kind)} ${seg.continuesFromPreviousDay ? "" : "rounded-t-[3px]"} ${seg.continuesToNextDay ? "" : "rounded-b-[3px]"}`}
            style={{
              top: `${(seg.startMinuteOfDay / MINUTES_PER_DAY) * 100}%`,
              height: `${Math.max(0.8, (spanMinutes(seg) / MINUTES_PER_DAY) * 100)}%`,
            }}
          >
            <DateLineChip badge={seg.dateLineBadge} />
            <SegmentText seg={seg} cityPreferences={cityPreferences} />
          </div>
        ))}
      </div>
      {day.zuluRulerLabel && (
        <div className="mt-0.5 truncate text-center font-mono text-[10px] leading-tight text-ink-faint" title="This local day's own boundaries, read in Zulu — so you can cross-check without switching the toggle.">
          {day.zuluRulerLabel}
        </div>
      )}
    </div>
  );
}

/** The shared left-hand hour gutter every day column lines up against. */
function HourGutter({ mode }: { mode: TimeMode }) {
  return (
    <div className="sticky left-0 z-10 w-7 shrink-0 bg-surface pr-1">
      <div style={{ height: DAY_HEADER_PX }} aria-hidden />
      <div className="relative" style={{ height: CALENDAR_HEIGHT_PX }}>
        {GUTTER_HOURS.map((h) => (
          <div
            key={h}
            className={`absolute right-0 font-mono text-[10px] leading-none text-ink-faint ${h === 0 ? "" : "-translate-y-1/2"}`}
            style={{ top: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, "0")}
          </div>
        ))}
        <div className="absolute right-0 bottom-0 font-mono text-[9px] leading-none text-ink-faint/70">{mode === "zulu" ? "Z" : "L"}</div>
      </div>
    </div>
  );
}

/**
 * The visual schedule — a real calendar week view: one column per day,
 * midnight-to-midnight top-to-bottom, so a long international trip reads
 * the way a pilot thinks about it ("day 3 starts with a long layover, day 4
 * is the long leg home"). Real, printed clock times drive every segment's
 * position; nothing here is estimated. `mode` decides whether day columns
 * (and every clock printed on them) follow Zulu or local calendar days —
 * see trip-timeline.ts for why those aren't the same grid.
 */
function TripTimelineChart({
  trip,
  days,
  mode,
  bidPeriodStart,
  cityPreferences,
}: {
  trip: Trip;
  days: TimelineDay[];
  mode: TimeMode;
  bidPeriodStart: string | null;
  cityPreferences?: Record<string, CitySentiment>;
}) {
  if (days.length === 0) return null;
  const hasStandby = trip.schedule.some((d) => d.legs.some((l) => l.isStandby));
  const hasDeadhead = trip.deadheadLegs > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-muted">
        <LegendSwatch className="bg-calendar-accent" label="Flying" />
        {hasDeadhead && <LegendSwatch className="hatch-deadhead bg-calendar-accent/15 ring-1 ring-inset ring-calendar-accent/50" label="Deadhead" title="Riding along, not operating" />}
        <LegendSwatch className="border-l-2 border-good bg-good/15" label="Hotel" title={LAYOVER_TOOLTIP} />
        {hasStandby && <LegendSwatch className="border-l-2 border-standby bg-standby/20" label="Hotel standby" title={STANDBY_TOOLTIP} />}
        <LegendSwatch className="bg-accent/55" label="Report / ground" title={GROUND_TOOLTIP} />
        {mode === "local" && <LegendSwatch className="bg-ink/10" label="Body-clock low" title={WOCL_TOOLTIP} />}
      </div>
      <div className="mt-1.5 flex overflow-x-auto pb-1">
        <HourGutter mode={mode} />
        <div className="flex min-w-0 flex-1 gap-1 pl-1">
          {days.map((day) => (
            <DayColumn
              key={day.dayNumber}
              day={day}
              mode={mode}
              date={mode === "local" ? tripDayDate(trip, bidPeriodStart, day.dayNumber) : null}
              cityPreferences={cityPreferences}
            />
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
 * The precise, textual counterpart to the chart above — every leg in an
 * aligned table, grouped by duty period, with the other clock system beside
 * each time. Both clocks always come from the bid pack's own printed HHMM
 * pair (`depTimeLocal`/`depTimeGmt`), never `leg.depTimeZulu` — that field
 * is anchored to an arbitrary reference instant purely for internally-
 * consistent day-math (see `Trip.zuluAnchor`).
 */
function Itinerary({ trip, mode, ratings, expandedKey, onToggleExpand }: ItineraryProps) {
  const clocks = mode === "zulu" ? "Z / L" : "L / Z";
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-hairline">
      <table className="w-full min-w-[30rem] border-collapse text-[11px]">
        <thead>
          <tr className={`${LABEL} bg-surface-raised/70 text-left`}>
            <th className="px-2 py-1 font-normal">Flight</th>
            <th className="px-2 py-1 font-normal">Route</th>
            <th className="px-2 py-1 font-normal">Out · {clocks}</th>
            <th className="px-2 py-1 font-normal">In · {clocks}</th>
            <th className="px-2 py-1 text-right font-normal">Block</th>
            <th className="px-2 py-1 font-normal">Equip</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {trip.schedule.map((duty, dutyIndex) => {
            const flown = duty.legs.filter((l) => !l.isDeadhead && !l.isStandby);
            const block = flown.reduce((a, l) => a + (l.blockHours ?? 0) * 60, 0);
            return (
              <Fragment key={dutyIndex}>
                <tr className="border-t border-hairline bg-calendar-accent/[0.06]">
                  <td colSpan={6} className="px-2 py-1 font-sans text-[11px] text-ink-muted">
                    <span className="font-mono font-semibold text-readout">Duty {dutyIndex + 1}</span>
                    {" · "}
                    {dutyStartLabel(duty, dutyIndex, mode, trip.schedule[dutyIndex - 1] ?? null)}
                    {flown.length > 0 && ` · ${flown.length} landing${flown.length === 1 ? "" : "s"} · ${hm(block)} block`}
                  </td>
                </tr>
                {duty.legs.map((leg, legIndex) => {
                  if (leg.isStandby) {
                    return (
                      <tr key={legIndex} className="border-t border-hairline/60">
                        <td className="px-2 py-1 text-standby">SBY</td>
                        <td className="px-2 py-1 text-ink">{leg.depAirport}</td>
                        <td className="px-2 py-1 text-ink">{formatHHMM(mode === "zulu" ? leg.depTimeGmt : leg.depTimeLocal)}</td>
                        <td className="px-2 py-1 text-ink">{formatHHMM(mode === "zulu" ? leg.arrTimeGmt : leg.arrTimeLocal)}</td>
                        <td colSpan={2} className="px-2 py-1 font-sans text-ink-muted">on call at the hotel — paid, not flying</td>
                      </tr>
                    );
                  }
                  const dep = mode === "zulu" ? [leg.depTimeGmt, leg.depTimeLocal] : [leg.depTimeLocal, leg.depTimeGmt];
                  const arr = mode === "zulu" ? [leg.arrTimeGmt, leg.arrTimeLocal] : [leg.arrTimeLocal, leg.arrTimeGmt];
                  return [
                    <tr key={legIndex} className="border-t border-hairline/60">
                      <td className="whitespace-nowrap px-2 py-1">
                        <span className={leg.isDeadhead ? "text-ink-muted" : "font-semibold text-ink"}>{leg.flightNumber}</span>
                        {leg.isDeadhead && <span className="ml-1 rounded bg-calendar-accent/15 px-1 text-[10px] text-ink-muted">DH</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-ink">
                        {leg.depAirport}<span className="text-ink-faint">–</span>{leg.arrAirport}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-readout">
                        {formatHHMM(dep[0])} <span className="text-ink-faint">{formatHHMM(dep[1])}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-readout">
                        {formatHHMM(arr[0])} <span className="text-ink-faint">{formatHHMM(arr[1])}</span>
                      </td>
                      <td className="px-2 py-1 text-right text-ink">{leg.blockHours !== null ? hm(leg.blockHours * 60) : "—"}</td>
                      <td className="px-2 py-1 text-ink-muted">{equipmentLabel(leg.equipment, leg.isDeadhead)}</td>
                    </tr>,
                    leg.dayRoomHotel && duty.legs[legIndex + 1] ? (
                      <tr key={`${legIndex}-dayroom`} className="border-t border-hairline/60 bg-good/[0.04]">
                        <td colSpan={6} className="px-2 py-1 font-sans text-ink-muted">
                          <span className={LABEL}>Day room</span>{" "}
                          <span className="font-mono font-semibold text-good">{leg.arrAirport}</span>{" "}
                          <span className="font-mono text-readout">{hm(duty.legs[legIndex + 1].startMinutes - leg.endMinutes)}</span>{" "}
                          <span className="capitalize text-ink">{leg.dayRoomHotel.toLowerCase()}</span>
                          <span className="text-ink-faint"> · a hotel between legs, same duty</span>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                {duty.layover && (
                  <LayoverRow
                    tripId={trip.id}
                    dutyIndex={dutyIndex}
                    city={duty.layover.city}
                    hotelName={duty.layover.hotelName}
                    hours={duty.layover.hours}
                    transport={duty.layover.transportToHotel}
                    ratings={ratings}
                    expandedKey={expandedKey}
                    onToggleExpand={onToggleExpand}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * When a duty starts, in the mode's clock. The first duty has a printed
 * report time; every later one starts at the hotel pickup the pack prints
 * on its "Trans From:" line (or, without one, where the previous layover's
 * printed length ends) — never the first departure mislabeled "report".
 */
function dutyStartLabel(duty: Trip["schedule"][number], dutyIndex: number, mode: TimeMode, previous: Trip["schedule"][number] | null): string {
  const printed = mode === "zulu" ? previous?.layover?.pickupTimeGmt : previous?.layover?.pickupTimeLocal;
  if (dutyIndex > 0 && printed) return `hotel pickup ${formatHHMM(printed)}`;
  const first = duty.legs[0];
  if (!first) return "";
  const dep = mode === "zulu" ? first.depTimeGmt : first.depTimeLocal;
  const lead = first.startMinutes - duty.startMinutes;
  const depMinutes = Number(dep.slice(0, 2)) * 60 + Number(dep.slice(2, 4));
  const start = clock((((depMinutes - lead) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return dutyIndex === 0 ? `report ${start}` : `hotel pickup ${start}`;
}

function LayoverRow({
  tripId,
  dutyIndex,
  city,
  hotelName,
  hours,
  transport,
  ratings,
  expandedKey,
  onToggleExpand,
}: {
  tripId: string;
  dutyIndex: number;
  city: string;
  hotelName: string | null;
  hours: number;
  transport: string | null;
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
      <span className="font-mono font-semibold text-good">{city}</span>
      <span className="font-mono text-readout">{formatDuration(hours)}</span>
      {hotelName && <span className="capitalize text-ink">{hotelName.toLowerCase()}</span>}
      {hotel?.rating != null && (
        <span className="inline-flex items-center gap-0.5 text-accent">
          <StarIcon className="h-2.5 w-2.5 fill-current" />
          {hotel.rating.toFixed(1)}
        </span>
      )}
      {transport && (
        <span className="capitalize text-ink-faint">
          · {hotelName && transport.toUpperCase() === hotelName.toUpperCase() ? "hotel shuttle" : transport.toLowerCase()}
        </span>
      )}
      {canExpand && <ChevronDownIcon className={`h-2.5 w-2.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />}
    </>
  );

  return (
    <tr className="border-t border-hairline/60 bg-good/[0.06]">
      <td colSpan={6} className="px-2 py-1 font-sans">
        {canExpand ? (
          <button type="button" onClick={() => onToggleExpand(detailKey)} className="flex flex-wrap items-center gap-x-1.5 text-left hover:text-ink" aria-expanded={expanded}>
            <span className={LABEL}>Hotel</span>
            {content}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span className={LABEL}>Hotel</span>
            {content}
          </div>
        )}
        {expanded && hotel && (
          <div className="mt-1.5 rounded-lg border border-hairline bg-surface p-2.5">
            <HotelQualityDetails hotel={hotel} />
          </div>
        )}
      </td>
    </tr>
  );
}

interface InsightChip {
  label: string;
  value: string;
  title: string;
  tone?: "warn";
}

/**
 * A compact read of `computeTripAnalytics` — real per-leg arithmetic. Each
 * chip only appears when its underlying field is non-null and clears a
 * "worth mentioning" bar, so a plain, unremarkable trip shows nothing rather
 * than a row of zeros.
 */
function TripInsights({ trip }: { trip: Trip }) {
  const a = computeTripAnalytics(trip);
  const chips: InsightChip[] = [];

  if (a.creditPerTafbHour !== null) {
    chips.push({
      label: "Credit per day away",
      value: `${(a.creditPerTafbHour * 24).toFixed(1)}h`,
      title: "Credit hours earned per 24 hours away from base — this trip's own pay-per-day-away rate, independent of how long the trip runs.",
    });
  }

  if (a.totalTimezoneCrossingMinutes !== null && a.totalTimezoneCrossingMinutes >= 60) {
    const netHours = (a.netTimezoneMinutes ?? 0) / 60;
    const direction = netHours > 0.5 ? "eastbound" : netHours < -0.5 ? "westbound" : "round-trip";
    chips.push({
      label: "Time zones",
      value: `${(a.totalTimezoneCrossingMinutes / 60).toFixed(1)}h, ${direction}`,
      title: "Total time-zone distance crossed across every leg (both directions added together), and which way the trip nets out overall.",
    });
  }

  if (a.avgSleepOpportunityHours !== null) {
    chips.push({
      label: "Avg sleep window",
      value: `${a.avgSleepOpportunityHours.toFixed(1)}h`,
      title: "Layover time minus the real hotel-pickup/ground gap around it — closer to actual usable rest than the printed layover duration.",
    });
  }

  if (a.dutyToBlockRatio !== null && a.dutyToBlockRatio >= 1.1) {
    chips.push({
      label: "Duty ÷ flying",
      value: `${a.dutyToBlockRatio.toFixed(1)}×`,
      title: "Total duty time divided by actual block time — higher means more of the day is ground time and connections than real flying.",
    });
  }

  if (a.backToBackRedEyeDuties > 0) {
    chips.push({
      label: "Back-to-back red-eyes",
      value: String(a.backToBackRedEyeDuties),
      tone: "warn",
      title: "Consecutive duty periods that each include a red-eye (00:00-05:00 local) departure or arrival — compounding fatigue risk rather than one bad night followed by recovery.",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
            chip.tone === "warn" ? "border-warn/40 bg-warn-soft text-warn" : "border-hairline bg-surface-raised/60 text-ink-muted"
          }`}
        >
          {chip.label} <span className="font-mono font-medium text-readout">{chip.value}</span>
        </span>
      ))}
    </div>
  );
}

function Readout({ label, value, note, tone = "text-readout", title }: { label: string; value: string; note?: string; tone?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className={`${LABEL} truncate`}>{label}</div>
      <div className={`truncate font-mono text-xs font-semibold ${tone}`}>
        {value}
        {note && <span className="ml-1 text-[10px] font-normal text-ink-muted">{note}</span>}
      </div>
    </div>
  );
}

/**
 * Everything about the trip as a whole, above its chart: its number and
 * length, the whole route stop by stop (layover cities lit, through-stops
 * dim), when it reports and when it's done, and the numbers pilots compare
 * trips by.
 */
function TripHeader({
  trip,
  days,
  mode,
  bidPeriodStart,
  homeBaseOffsetMinutes,
  cityPreferences,
}: {
  trip: Trip;
  days: TimelineDay[];
  mode: TimeMode;
  bidPeriodStart: string | null;
  homeBaseOffsetMinutes: number | null;
  cityPreferences?: Record<string, CitySentiment>;
}) {
  const circadian = computeCircadianAssessment(trip, homeBaseOffsetMinutes);
  const route = tripRoute(trip);
  const layovers = new Set(trip.schedule.flatMap((d) => (d.layover ? [d.layover.city] : [])));
  const block = tripBlockMinutes(trip);
  const duties = tripDutyPeriods(trip);
  const first = days[0] ? dayStats(days[0]) : null;
  const last = days.length ? dayStats(days[days.length - 1]) : null;
  const startDate = mode === "local" ? tripDayDate(trip, bidPeriodStart, 1) : null;
  const endDate = mode === "local" ? tripDayDate(trip, bidPeriodStart, days.length) : null;
  const stamp = (d: ReturnType<typeof tripDayDate>, n: number) => (d ? `${d.weekday} ${d.day}` : `day ${n}`);
  const zone = mode === "zulu" ? "Z" : "local";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {trip.pairingNumber !== null && (
          <span className="rounded-md border border-calendar-accent/40 bg-calendar-accent/10 px-1.5 py-0.5 font-mono text-sm font-semibold text-readout" title="Trip number in the bid pack">
            #{trip.pairingNumber}
          </span>
        )}
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-ink">{trip.days}-day</span>
        {trip.international && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">Intl</span>
        )}
        <CircadianStars assessment={circadian} size="sm" />
        <span className="ml-auto font-mono text-sm font-semibold text-readout">
          {hm(trip.creditHours * 60)} <span className="text-[10px] font-normal uppercase tracking-[0.14em] text-ink-faint">credit</span>
        </span>
      </div>

      {route.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1 font-mono text-xs" aria-label={`Route: ${route.join(", ")}`}>
          {route.map((code, i) => {
            const isLayover = layovers.has(code) && i > 0 && i < route.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <span className="text-ink-faint/70">›</span>}
                <span className={isLayover ? "font-semibold text-good" : i === 0 || i === route.length - 1 ? "text-ink" : "text-ink-muted"}>
                  {code}
                  {isLayover && <Sentiment sentiment={cityPreferences?.[code]} />}
                </span>
              </Fragment>
            );
          })}
        </div>
      )}

      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-6">
        <Readout label="Report" value={first?.onDuty ?? REPORT_LABELS[trip.reportTime]} note={stamp(startDate, 1)} title={`${REPORT_LABELS[trip.reportTime]} report, ${zone}${startDate ? ` — ${startDate.weekday} ${startDate.day} ${startDate.month}` : ""}`} />
        <Readout label="Last in" value={last?.lastIn ?? (block === null && trip.landings === 0 ? "no flying" : "—")} note={stamp(endDate, days.length)} title={`Last block-in of the trip, ${zone}${endDate ? ` — ${endDate.weekday} ${endDate.day} ${endDate.month}` : ""}`} />
        <Readout label="TAFB" value={hm(trip.tafbHours * 60)} title="Time away from base" />
        <Readout label="Block" value={block !== null ? hm(block) : trip.landings === 0 ? "none" : "—"} title="Operated flying time, deadheads excluded" />
        <Readout label="Duty · ldg" value={`${duties} · ${trip.landings}`} title="Duty periods (hotel standby days included) and landings" />
        <Readout
          label={(trip.standbyDays ?? 0) > 0 ? "Standby · DH" : "Deadhead"}
          value={(trip.standbyDays ?? 0) > 0 ? `${trip.standbyDays}d · ${trip.deadheadLegs}` : trip.deadheadLegs > 0 ? `${trip.deadheadLegs} leg${trip.deadheadLegs > 1 ? "s" : ""}` : "none"}
          tone={(trip.standbyDays ?? 0) > 0 ? "text-standby" : "text-readout"}
          title="Hotel standby days, and legs ridden as a passenger"
        />
      </div>
    </div>
  );
}

/**
 * Every one of the chart's generic explanations, in one findable reference
 * instead of hover-only tooltips a phone can't reach.
 */
function TripLegendInfo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center text-[11px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        What do these mean?
      </button>

      {open && (
        <Modal title="Trip calendar key" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
            <div>
              <div className="font-medium text-ink">Reading a day</div>
              <ul className="mt-1.5 space-y-2">
                <li>
                  Each column is one day, midnight at the top to midnight at the bottom. The header
                  gives the date, then <span className="font-mono text-ink">09:31–18:04</span>: when the
                  duty starts (report, or hotel pickup) and when it&rsquo;s done (the last flight blocks
                  in, or hotel standby ends). Two dots
                  mean the duty runs in from the day before or on into the next. Under it: that
                  day&rsquo;s flying (block) time and landings.
                </li>
                <li>
                  On a flight: departure time and airport at the top, arrival at the bottom, the flight
                  number and block time between. Short flights show just the route.
                </li>
                <li>
                  On a hotel stay: the city and the layover&rsquo;s full length, the hotel, and the
                  pickup time for the next duty.
                </li>
                <li>
                  The shaded band from 02:00 to 06:00 (Local only) is your body clock&rsquo;s low
                  point &mdash; flying or reporting inside it is what the circadian stars weigh most.
                </li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">Colors</div>
              <ul className="mt-1.5 space-y-2">
                <li><span className="font-medium text-ink">Solid.</span> Flying, wheels up to wheels down.</li>
                <li><span className="font-medium text-ink">Hatched.</span> Deadhead &mdash; riding along, not operating.</li>
                <li><span className="font-medium text-ink">Green edge.</span> {LAYOVER_TOOLTIP}</li>
                <li><span className="font-medium text-ink">Violet edge.</span> {STANDBY_TOOLTIP}</li>
                <li><span className="font-medium text-ink">Amber band.</span> {GROUND_TOOLTIP} Thin gray bands are connections: {CONNECTION_TOOLTIP.toLowerCase()}</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">The trip&rsquo;s numbers</div>
              <ul className="mt-1.5 space-y-2">
                <li><span className="font-medium text-ink">Route.</span> Every stop in order; layover cities are in green (with ♥ or ✕ if you love or avoid them).</li>
                <li><span className="font-medium text-ink">TAFB.</span> Time away from base. <span className="font-medium text-ink">Block.</span> Flying you operate, deadheads excluded.</li>
                <li><span className="font-medium text-ink">Credit per day away.</span> Credit earned per 24 hours away from base.</li>
                <li><span className="font-medium text-ink">Time zones.</span> Total time-zone distance crossed, and which way the trip nets out.</li>
                <li><span className="font-medium text-ink">Avg sleep window.</span> Layover time minus the pickup/ground gap around it &mdash; closer to usable rest than the printed layover.</li>
                <li><span className="font-medium text-ink">Duty ÷ flying.</span> Duty time divided by block time &mdash; higher means more sitting and connecting.</li>
                <li><span className="font-medium text-ink">Back-to-back red-eyes.</span> Consecutive duties that each fly between midnight and 5am.</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">Other marks</div>
              <ul className="mt-1.5 space-y-2">
                <li><span className="font-medium text-ink">+1d / -1d.</span> A flight crossing the date line &mdash; tap the badge for the details.</li>
                <li><span className="font-medium text-ink">Label under a column.</span> That local day&rsquo;s boundaries read in Zulu, to cross-check without switching the toggle.</li>
                <li><span className="font-medium text-ink">Itinerary.</span> Every leg as a table: the main clock first, the other one beside it in gray; &ldquo;airline&rdquo; means a deadhead on another carrier, &ldquo;ground&rdquo; a car or cab.</li>
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

interface TripListProps {
  trips: Trip[];
  /** Real UTC offset derived from the bid pack's own printed times — see lib/circadian.ts. Null when it couldn't be derived. */
  homeBaseOffsetMinutes: number | null;
  /** The bid period's first real day, so each trip day can show its date. */
  bidPeriodStart?: string | null;
  /** The pilot's loved/avoided layover cities, marked on the route and the hotel stays. */
  cityPreferences?: Record<string, CitySentiment>;
}

export function TripList({ trips, homeBaseOffsetMinutes, bidPeriodStart = null, cityPreferences }: TripListProps) {
  const [ratings, setRatings] = useState<Record<string, HotelResult | null>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openItineraries, setOpenItineraries] = useState<Set<string>>(new Set());
  // Starts at the same fixed default the server renders, then syncs to the
  // pilot's stored choice once mounted — reading localStorage during render
  // would mismatch the server's HTML.
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

  function toggleItinerary(key: string) {
    setOpenItineraries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <TimeModeToggle mode={mode} onChange={handleModeChange} />
        <div className="flex items-center gap-3">
          <TripLegendInfo />
          <CircadianInfo />
        </div>
      </div>
      <ul className="space-y-3">
        {trips.map((trip, tripIndex) => {
          // `trip.id` alone isn't unique — the same short pairing flown
          // several times in one month legitimately appears more than once
          // in this line's `trips` array.
          const key = `${trip.id}-${tripIndex}`;
          const days = buildTimelineDays(trip, mode);
          return (
            <li key={key} className="rounded-[var(--radius-panel)] border border-hairline bg-surface/60 p-3 shadow-[inset_0_1px_0_var(--panel-highlight)]">
              <TripHeader
                trip={trip}
                days={days}
                mode={mode}
                bidPeriodStart={bidPeriodStart}
                homeBaseOffsetMinutes={homeBaseOffsetMinutes}
                cityPreferences={cityPreferences}
              />

              <TripInsights trip={trip} />

              {trip.schedule.length > 0 ? (
                <div className="mt-2.5">
                  <TripTimelineChart trip={trip} days={days} mode={mode} bidPeriodStart={bidPeriodStart} cityPreferences={cityPreferences} />
                  <button
                    type="button"
                    onClick={() => toggleItinerary(key)}
                    className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink"
                    aria-expanded={openItineraries.has(key)}
                  >
                    {openItineraries.has(key) ? "Hide" : "Show"} every leg &mdash; times, flights, aircraft, hotels
                    <ChevronDownIcon className={`h-2.5 w-2.5 shrink-0 transition-transform ${openItineraries.has(key) ? "rotate-180" : ""}`} />
                  </button>
                  {openItineraries.has(key) && (
                    <Itinerary trip={trip} mode={mode} ratings={ratings} expandedKey={expandedKey} onToggleExpand={handleToggleExpand} />
                  )}
                </div>
              ) : (
                trip.layoverDetails.some((d) => d.hotelName) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                    {trip.layoverDetails
                      .filter((d) => d.hotelName)
                      .map((layover, i) => {
                        const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                        const detailKey = `${trip.id}-fallback-${layover.city}-${i}`;
                        const canExpand = !!hotel && hasHotelQualityDetails(hotel);
                        const content = (
                          <>
                            <span className="font-mono font-medium text-good">{layover.city}</span>
                            <span className="capitalize">{layover.hotelName?.toLowerCase()}</span>
                            {hotel?.rating != null && (
                              <span className="inline-flex items-center gap-0.5 text-accent">
                                <StarIcon className="h-3 w-3 fill-current" />
                                {hotel.rating.toFixed(1)}
                              </span>
                            )}
                            {canExpand && (
                              <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${expandedKey === detailKey ? "rotate-180" : ""}`} />
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
                      <div key={detailKey} className="mt-2 rounded-lg border border-hairline bg-canvas p-3">
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
