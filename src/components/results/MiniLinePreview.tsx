"use client";

import { reachSpans, type LineVacationMark } from "@/lib/vacation-marks";
import { useInView } from "motion/react";
import { memo, useMemo, useState, type ReactNode } from "react";
import { BedIcon } from "@/components/ui/icons";
import { CalendarDayBars } from "@/components/results/CalendarDayBars";
import { HeatKey, heatOfTrips, heatPiecesOn, HeatReasons, type HeatOf } from "@/components/results/HeatReasons";
import type { TripHeat } from "@/lib/line-heat";
import { useMeasuredWidth } from "@/components/results/LegBars";
import { CreditHours, Zone } from "@/components/results/TripMarks";
import { ColorKey } from "@/components/results/ColorKey";
import { TimeModeToggle } from "@/components/results/TimeModeToggle";
import { useTimeMode } from "@/lib/time-mode-storage";
import { labeledStayPieces } from "@/lib/leg-bars";
import { Modal } from "@/components/ui/Modal";
import { buildDetailedMonth, type DetailedDay, type DetailedMonth, type MonthDepartureOptions, type MonthSummary, type TripFinish } from "@/lib/month-detail";
import { dayStats, equipmentLabel, hm } from "@/lib/trip-day-stats";
import { BASE_TURN_MAX_HOURS, DEFAULT_MIN_HOME_HOURS } from "@/lib/metrics/departures";
import type { TimeMode, TimelineSegment, TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import { BodyClockBadge, BodyClockFact, BodyClockReasons } from "@/components/results/BodyClock";
import { lineBodyClockScore, type BodyClockScore } from "@/lib/body-clock-score";
import type { CityMark } from "@/types/preferences";

/**
 * The whole bid month for one line, as much of it as a card can carry, laid
 * out the way the ex-pilot sketched it: each day shows its trip's own number
 * and credit hours, when it reports, its flights drawn as he drew them in his
 * paper organizer — a bold line per leg, to scale and placed by the time of
 * day, the cities over its ends (`CalendarDayBars`) — each layover a line of its own
 * under the flying with its city and length, and where and when the trip ends.
 * One vivid color each for a flight, a deadhead, a layover and a report time.
 * Tapping a day opens everything the bid pack says about it below the grid; a
 * strip under it sums the month up in the terms the interview asks about
 * (days off and how they fall, standby, report times, cities…). Each trip, day
 * by day in the same picture, is in the expanded card.
 */

/** The calendar's own colors, so a day's list below the grid reads as the same things as its picture. */
const STRIP_CLASS: Record<TimelineSegmentKind, string> = {
  flying: "bg-leg",
  deadhead: "bg-deadhead",
  standby: "bg-standby",
  layover: "bg-layover",
  ground: "bg-accent/70",
  connection: "bg-border-strong",
  sleep: "bg-sleep",
};

/** Narrowest day first; each a quarter rem wider. Written out whole so the stylesheet has every one. */
const CREDIT_FITS = [
  "@min-[5.25rem]:inline", "@min-[5.5rem]:inline", "@min-[5.75rem]:inline", "@min-[6rem]:inline", "@min-[6.25rem]:inline",
  "@min-[6.5rem]:inline", "@min-[6.75rem]:inline", "@min-[7rem]:inline", "@min-[7.25rem]:inline", "@min-[7.5rem]:inline",
];

/**
 * The narrowest day a trip's credit fits in beside the date and the number. One width for every trip let "28 #2004
 * 87:26CH" (and "3 #2031 49:58CH") run past the day's edge into the next at 1024 wide: the room it needs is worked out
 * from its own characters (each about 0.43rem in the 2xs type, the oval's padding and "CH" about 0.9rem).
 */
function creditFits(day: DetailedDay): string {
  const dateRem = (day.label.length + (day.nextMonth ? 3 : 0)) * 0.44 + 0.125;
  const ovalRem = 0.9 + (`#${day.tripNumber} `.length + hm(Math.round((day.tripCreditHours ?? 0) * 60)).length) * 0.43;
  const step = Math.ceil((dateRem + ovalRem + 0.1 - 5.25) / 0.25);
  return CREDIT_FITS[Math.min(CREDIT_FITS.length - 1, Math.max(0, step))];
}

function cellClass(day: DetailedDay, selected: boolean): string {
  // The padding in px, as the grid's gap is: the bars' width, how far they run on past midnight (`CELL_BLEED`) and the
  // trip's rail are worked out in px from them. In rem, with a phone's text set larger, they grew while all that didn't,
  // and a day narrowed to almost nothing between them.
  const base =
    "@container relative flex min-h-[4.75rem] min-w-0 flex-col gap-0.5 rounded-md p-[4px] text-left leading-none transition-colors focus-visible:ring-2 focus-visible:ring-brand sm:min-h-[6.25rem]";
  const ring = selected ? " ring-2 ring-brand ring-offset-1 ring-offset-surface" : "";
  switch (day.kind) {
    case "off":
      // A dashed outline, not a border: a border would set the day's picture a pixel in from a trip day's, and a flight
      // running on past midnight into it would step.
      return `${base} outline-1 -outline-offset-1 outline-dashed ${day.isWeekend ? "outline-border-strong/70 bg-surface-raised/40" : "outline-border-strong/40"} text-ink-faint hover:outline-ink-faint${ring}`;
    case "standby":
      return `${base} focus:outline-none bg-standby/20 text-ink hover:bg-standby/30${ring}`;
    case "estimated":
      return `${base} focus:outline-none bg-brand-soft text-brand${ring}`;
    default:
      // Every day of a trip shares one tint, so a trip reads as one block; what each day holds is printed on it.
      return `${base} focus:outline-none bg-trip-wash text-ink hover:bg-trip-wash-strong${ring}`;
  }
}


/**
 * The bar across the top of a trip's days, joined across the gaps between
 * them, so a four-day trip reads as one thing from Monday to Thursday — it
 * starts on the trip's first day and stops on its last (or at the edge of
 * the week, where the grid wraps).
 */
function TripRail({ joinLeft, joinRight, standby }: { joinLeft: boolean; joinRight: boolean; standby: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute top-0 h-[3px] ${standby ? "bg-standby" : "bg-calendar-accent"} ${joinLeft ? "" : "rounded-l-full"} ${joinRight ? "" : "rounded-r-full"}`}
      style={{ left: joinLeft ? -4 : 2, right: joinRight ? -4 : 2 }}
    />
  );
}

/** A day's padding and half the gap to the next: how far a line at midnight runs on, to meet the next day's. */
const CELL_BLEED = 6;

/** 107 → "1h47": time on the ground between two chained trips. */
const turnLabel = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

/** Turns this short are a straight turn at the domicile; longer, the pilot is sitting at base between trips because home is too far to be worth it. */
const STRAIGHT_TURN_MINUTES = 6 * 60;

/** "L" or "Z", for a time written in a sentence. */
const clockOf = (mode: TimeMode) => (mode === "zulu" ? "Z" : "L");

/**
 * What joining two trips means for this pilot, in a sentence: on the hours at home they were joined by. Said as 24 for
 * everyone, a commuter who goes home only for two days read the wrong rule, and a pilot who lives at base was told he
 * couldn't get home on a nine-hour turn there.
 */
export function chainSentence(c: NonNullable<DetailedDay["chain"]>, mode: TimeMode = "local"): string {
  const times = c.landed && c.reports ? `: lands ${c.city} ${c.landed}, reports again ${c.reports} (${clockOf(mode)})` : "";
  if (c.turnMinutes < STRAIGHT_TURN_MINUTES)
    return `Turns straight out of trip #${c.fromTripNumber ?? ""}${times} — ${turnLabel(c.turnMinutes)} on the ground, so the two are flown as one departure from home.`;
  const follows = `Follows trip #${c.fromTripNumber ?? ""} after ${turnLabel(c.turnMinutes)} in ${c.city}${times}.`;
  if (c.homeHours === null) return `${follows} Under ${BASE_TURN_MAX_HOURS} hours between them, so the two count as one departure.`;
  return `${follows} That's not long enough to get home and have ${c.homeHours ?? DEFAULT_MIN_HOME_HOURS} hours there, so the two are one departure — and the time between is spent in ${c.city}.`;
}

/**
 * When the trip reports, in the report color. A trip turned straight out of the one before also says how long it sits at
 * base in between. In px, as the 11px row it sits in (`CalendarDayBars`) is.
 */
function Report({ day, mode }: { day: DetailedDay; mode: TimeMode }) {
  const time = day.chain ? day.chain.reports || day.dutyStart : day.isTripStart ? day.dutyStart : null;
  if (!time) return null;
  // "Rpt 03:06L · 28h46 turn" is 156px and a desktop's day 147: the end of "turn" was cut off (A300 MEM FO line 2079).
  // Once the turn shows, "Rpt" steps aside for it — the orange time is the report — until the day has room for all of it.
  const rpt = !day.chain
    ? "@min-[4.75rem]:inline"
    : turnLabel(day.chain.turnMinutes).length <= 4
      ? "@min-[4.75rem]:@max-[8.5rem]:inline @min-[9.5rem]:inline"
      : "@min-[4.75rem]:@max-[8.5rem]:inline @min-[10rem]:inline";
  return (
    <>
      <span
        className="whitespace-nowrap font-mono text-[11px] font-semibold leading-none text-report"
        title={`Reports ${time} ${mode === "zulu" ? "Zulu" : "local"}${day.earlyReport ? " — between 2 and 6am local" : ""}`}
      >
        <span className={`hidden ${rpt}`}>Rpt </span>
        {/* A phone's day has room for the time but not its "L"; a small phone's, not even the time: cut off, "21:50"
            read "21:5". Left to the day's details, a tap away, rather than shown wrong. */}
        <span className="hidden @min-[2rem]:inline">{time}</span>
        <span className="hidden @min-[2.5rem]:inline">
          <Zone mode={mode} />
        </span>
      </span>
      {day.chain && <span className="hidden whitespace-nowrap font-mono text-[11px] text-ink-muted @min-[8.5rem]:inline" title={chainSentence(day.chain, mode)}>&nbsp;· {turnLabel(day.chain.turnMinutes)} turn</span>}
    </>
  );
}

/** Where and when the trip ends, on its own last day — "END MEM 23:59L", "+1" when that's after midnight. */
function End({ finish, mode }: { finish: TripFinish; mode: TimeMode }) {
  return (
    // Wraps where a phone's day is too narrow for it all on one line: kept on one, "END ANC +1" ran on into the next
    // day, over its "9 off". Narrower than "END" itself (a phone with its text at its largest), it's left to the day's
    // details, a tap away, as the trip's number is: there, "END MEM" ran over the next day's "10 off". "END" is 1.34rem
    // wide and may run into the day's 4px of padding, no further: hidden only below 0.75rem, at 150% on a 320 phone it
    // ran past its day.
    <span className="flex min-w-0 flex-wrap @max-[calc(1.34rem-4px)]:hidden items-baseline gap-x-0.5 gap-y-px whitespace-nowrap font-mono text-2xs leading-none text-ink @min-[4.75rem]:text-2xs" title={`Trip ends: lands ${finish.city} ${finish.time} (${clockOf(mode)})${finish.nextDay ? ", just after midnight" : ""}`}>
      <span className="text-2xs font-semibold tracking-wide text-ink-muted">END</span>
      <span className="font-semibold">{finish.city}</span>
      <span className="hidden @min-[4.75rem]:inline">
        {finish.time}
        <Zone mode={mode} />
      </span>
      {finish.nextDay && <span className="text-2xs text-ink-muted">+1</span>}
    </span>
  );
}

/** What the picture draws on a day: flying, standby or a layover. */
const DRAWN = new Set<TimelineSegmentKind>(["flying", "deadhead", "standby", "layover"]);

/**
 * One day of the month, top to bottom at the same heights on every day — so a week's bars line up and a flight or a
 * layover past midnight meets itself in the next day: the date and the trip's oval, the report, the day's flying and
 * layovers (`CalendarDayBars`), and where the trip ends on its last day. Tap the day for every flight and time. Too narrow for
 * the cities (a phone), the bars and the layover's city alone.
 */
function Cell({
  day,
  selected,
  onSelect,
  index,
  joinLeft,
  joinRight,
  barWidth,
  stayLabeled,
  cityPreferences,
  mode,
  heatOf,
  vacation = null,
}: {
  day: DetailedDay;
  selected: boolean;
  onSelect: () => void;
  index: number;
  joinLeft: boolean;
  joinRight: boolean;
  /** The width the day's bars are drawn at. */
  barWidth: number;
  stayLabeled: (s: TimelineSegment) => boolean;
  cityPreferences?: Record<string, CityMark>;
  mode: TimeMode;
  heatOf?: HeatOf;
  vacation?: VacationDay | null;
}) {
  const isOff = day.kind === "off";
  const standby = day.flights.find((f) => f.kind === "standby");
  // The end of another trip that morning (a landing just after midnight), then this day's own.
  const pieces = [...(day.spill?.segments ?? []), ...(isOff ? [] : day.segments)];
  const report = isOff ? null : <Report day={day} mode={mode} />;
  const drawn = pieces.some((s) => DRAWN.has(s.kind));
  return (
    <button
      type="button"
      onClick={onSelect}
      title={day.title}
      aria-label={day.title}
      aria-pressed={selected}
      className={cellClass(day, selected)}
      style={{ "--i": index } as React.CSSProperties}
    >
      {!isOff && day.tripIndex !== null && day.kind !== "estimated" && <TripRail joinLeft={joinLeft} joinRight={joinRight} standby={day.kind === "standby"} />}
      {/* The vacation: its days ringed and washed gold, where the pack had it dashed, the days it could slide to hatched along the foot. */}
      {vacation?.on && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md bg-accent/12 ring-2 ring-inset ring-accent" />}
      {vacation?.awarded && !vacation.on && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-md border border-dashed border-accent/70" />}
      {vacation?.reach && !vacation.on && (
        // Along the foot: the top edge is the trip's own rail, in much the same colour.
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px] rounded-b-md opacity-80" style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--color-accent) 0 1.5px, transparent 1.5px 4px)" }} />
      )}
      {day.nextMonth && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-b-md bg-carry" />}
      <span className="flex h-3 items-center justify-between gap-0.5">
        {/* Grows with the text up to 150%, like the weekday names: at 200% a phone's dates ran together ("282930"). */}
        <span className={`text-[length:min(var(--text-2xs),16.5px)] leading-4 tabular-nums ${isOff ? "" : "font-semibold"}`}>
          {day.label}
          {/* Too narrow for it beside the date (a phone), "26 NOV27 NOV" ran together: the carry bar along the bottom says it. */}
          {day.nextMonth && <span className="ml-0.5 hidden text-2xs font-semibold uppercase tracking-wide text-carry @min-[2.5rem]:inline">{day.nextMonth.slice(0, 3)}</span>}
        </span>
        {day.isTripStart && day.tripNumber && (
          <>
            <span className="hidden whitespace-nowrap rounded bg-calendar-accent px-0.5 font-mono text-2xs font-semibold text-on-calendar @min-[4.75rem]:inline" title={day.tripCreditHours !== null ? `Trip #${day.tripNumber}, ${hm(day.tripCreditHours * 60)} credit hours` : undefined}>
              #{day.tripNumber}
              {day.tripCreditHours !== null && (
                <span className={`hidden ${creditFits(day)}`}>
                  {" "}
                  <CreditHours hours={day.tripCreditHours} className="font-normal" />
                </span>
              )}
            </span>
            {/* On a phone the oval won't fit beside the date: the number alone. In the narrowest cells (a phone's week) even
                that spills into the next day ("13 #50214"), so it's left to the day's details, a tap away. */}
            <span className="hidden font-mono text-2xs font-semibold text-ink @min-[3.25rem]:inline @min-[4.75rem]:hidden">#{day.tripNumber}</span>
          </>
        )}
      </span>

      {drawn ? (
        <CalendarDayBars
          segments={pieces}
          widthPx={barWidth}
          stayLabeled={stayLabeled}
          cityPreferences={cityPreferences}
          top={report}
          bleed={CELL_BLEED}
          zulu={mode === "zulu"}
          heatOf={heatOf}
        />
      ) : (
        !isOff && <span className="flex h-[11px] items-center overflow-hidden">{report}</span>
      )}
      {day.preReportTime !== null && <span className="hidden text-2xs leading-tight text-ink-muted @min-[4.75rem]:block">reports next morning</span>}

      {/* The day's last words, and its vacation's "VAC 7" beside them where they leave room, else on a line under them: laid
          over the corner, it ran into "4 off" and "END MEM 07:50" on a phone's narrow days. A day too narrow for "VAC 7"
          even into its padding (a phone with its text set larger) leaves it to the gold ring. */}
      <span className="mt-auto flex min-w-0 flex-wrap items-end gap-x-1 gap-y-px">
        <span className="flex min-w-0 flex-auto flex-col gap-px">
          {standby && (
            <span className="whitespace-nowrap font-mono text-2xs font-semibold text-standby">
              SBY<span className="hidden @min-[3.25rem]:inline"> {standby.from}</span>
            </span>
          )}
          {isOff && day.offRun && day.offRun.length > 1 && day.offRun.isFirst && (
            // Up to 150% as the date is: at 200% "off" ran into the next day.
            <span className="text-[length:min(var(--text-2xs),16.5px)] font-medium leading-tight">
              {day.offRun.length}
              <span className="hidden @min-[4.75rem]:inline"> days</span> off
            </span>
          )}
          {day.fullDay && (
            // Wraps on a phone rather than run into the next day. A day narrower than "barely" (a 320 px phone, or one with
            // its text set larger) leaves it to the day's details, a tap away: it ran on into the next day. Narrower than
            // "Full" itself (a phone with its text at 200%), so is all of it: "FullFull dayday" ran across two days.
            <span className="hidden text-2xs font-semibold leading-tight text-layover @min-[1.25rem]:inline" title={day.fullDay.barely ? "A full day — just barely: up before 6 the next morning" : "A full day free in the city"}>
              Full day{day.fullDay.barely ? <span className="hidden font-normal @min-[1.875rem]:inline">, barely</span> : null}
            </span>
          )}
          {!isOff && day.finish && <End finish={day.finish} mode={mode} />}
        </span>
        {vacation?.first != null && (
          <span aria-hidden className="ml-auto whitespace-nowrap font-mono text-[9px] font-bold leading-none text-accent @max-[22px]:hidden">
            VAC {vacation.first}
          </span>
        )}
      </span>
    </button>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 shrink-0 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

function MonthKeyInfo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink print:hidden">
        What do these mean?
      </button>
      {open && (
        <Modal title="Month calendar key" onClose={() => setOpen(false)}>
          <ul className="space-y-3 text-sm leading-relaxed text-ink-muted">
            <li><span className="font-medium text-ink">Each week reads like a line in the bid pack.</span> Shaded days joined by a bar across the top are one trip. Its first day carries the trip&rsquo;s number and credit hours (<span className="font-mono">#111 17:47CH</span>) and when it reports, in orange (<span className="font-mono font-semibold text-report">Rpt 06:30L</span>). L is local time, Z Zulu.</li>
            <li><span className="font-medium text-ink">The lines in each day.</span> Each flight is a <span className="font-medium text-leg">blue</span> line with a tick at each end, as long as the flight and placed by the time of day &mdash; midnight at the left edge, midnight at the right, on the domicile&rsquo;s clock. A <span className="font-medium text-deadhead">magenta</span> line is a deadhead, riding along. The cities are written over the ends; where two legs meet, the city between them is written once. A flight still in the air at midnight runs off the right edge and on into the next day. The grey band around the lines is the whole duty period, report to the end of its last leg, so a long wait between two short flights shows. Small ticks mark 6am, noon and 6pm.</li>
            <li><span className="font-medium text-ink">Trips joined into one bar.</span> Trips flown without going home in between &mdash; one departure. For a commuter that&rsquo;s whenever there wouldn&rsquo;t be the hours at home you said make going home worth it (24 if you didn&rsquo;t say) between them, counting the trip home and back (<span className="font-mono">Rpt 02:30L · 1h47 turn</span> is a straight turn at the domicile). For a pilot who lives in the domicile city, only trips that turn within a few hours.</li>
            <li><span className="font-medium text-ink">Green line.</span> A layover, from landing to the next show, under the flying, with the city and its length to the hour (<span className="font-mono font-semibold text-layover">SEA 16h</span>) &mdash; on its longest day, or at the top of the day when it&rsquo;s too short for the words. <span className="text-good">♥</span> is a city you love, <span className="text-good">♡</span> one you like, an amber <span className="text-warn">✕</span> one you dislike and a red <span className="text-danger">✕</span> one you avoid.</li>
            <li><span className="font-medium text-ink">Full day.</span> A whole day free in a layover city: in the hotel by about 2 AM the night before, and a full night after it &mdash; not up before about 6 the next morning (&ldquo;barely&rdquo; when it&rsquo;s earlier, up as early as about 3:15).</li>
            <li><span className="font-medium text-ink">END MEM 19:05L.</span> Where and when the trip ends, on its last day. <span className="font-mono">+1</span> means just after midnight &mdash; the bid pack still counts the next day as off.</li>
            <li><span className="font-medium text-ink">Violet day.</span> Hotel standby (<span className="font-mono">SBY</span>) &mdash; on call at the hotel, paid, not flying.</li>
            <li><span className="font-medium text-ink">Dashed empty day.</span> A day off; a run of them is labeled on its first day (&ldquo;4 days off&rdquo;).</li>
            <li><span className="font-medium text-ink">Tap any day</span> for every flight with its times and aircraft, the hotel and rest, block time and landings. The hour-by-hour chart for each trip is under &ldquo;Details&rdquo;.</li>
            <li><span className="font-medium text-ink">Local or Zulu.</span> The switch over the calendar picks the clock. Local: each day is the domicile&rsquo;s own calendar day, the one the bid pack counts days off on, and every time is local where it happens (L). Zulu: each day runs midnight to midnight Z and every time is Zulu (Z), so a trip can sit a day later than it does in Local &mdash; an evening report at a US domicile is already tomorrow in Zulu. The numbers under the calendar are the line&rsquo;s own month either way.</li>
          </ul>
        </Modal>
      )}
    </>
  );
}

/**
 * The key to every month grid on the page — shown once above a list of them rather than under each one, and under each
 * one only where a grid stands alone (the comparison view). The colors are keyed right above each grid (`ColorKey`);
 * this keeps the marks that aren't colors.
 */
export function MonthLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted ${className}`}>
      <span className="inline-flex items-center gap-1">
        <span className="relative inline-flex h-4 items-start rounded-[3px] bg-trip-wash px-0.5 text-2xs font-semibold leading-none text-ink">
          26<span className="ml-0.5 text-2xs uppercase text-carry">Nov</span>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] rounded-b-[3px] bg-carry" />
        </span>
        Carry-over: flown in the next bid month, not counted in this one
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="text-2xs font-semibold text-layover">Full day</span>
        A whole day free in a layover city, between two full nights
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="rounded bg-calendar-accent px-0.5 font-mono text-2xs font-semibold text-on-calendar">
          #111 <CreditHours hours={17.78} className="font-normal" />
        </span>
        Trip and its credit hours
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-2xs font-semibold text-report">
          Rpt 06:30
          <Zone />
        </span>
        L local, Z Zulu
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-2xs font-semibold leading-none text-layover">
          SEA<span className="font-normal"> 16h</span>
        </span>
        Layover, to the hour
      </span>
      <span className="inline-flex items-center gap-1"><span className="text-good">♥</span>love <span className="text-good">♡</span>like <span className="text-warn">✕</span>dislike</span>
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-2xs">
          <span className="text-2xs font-semibold text-ink-muted">END </span>
          <span className="font-semibold">MEM</span> 19:05
          <Zone />
        </span>
        Trip ends
      </span>
      <LegendItem swatch="border border-dashed border-border-strong" label="Day off" />
      <MonthKeyInfo />
    </div>
  );
}

/** The day's own numbers in one line — the same read the expanded card's trip chart puts above this day's column. */
/** "Mon Oct 5" for an ISO date. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
}

function DayNumbers({ day, mode }: { day: DetailedDay; mode: TimeMode }) {
  const c = clockOf(mode);
  const st = dayStats({ dayNumber: day.tripDay ?? 1, segments: day.segments });
  const parts: string[] = [];
  // In time order, one phrase per duty — a day can finish last night's flying and start tonight's.
  for (const w of st.windows) {
    if (w.start && w.end) parts.push(`on duty ${w.start}–${w.end} (${c})`);
    else if (w.end) parts.push(`lands ${w.end} (${c}) from the night before`);
    else if (w.start) parts.push(`on duty ${w.start} (${c}), through midnight`);
  }
  if (st.blockMinutes > 0) parts.push(`${hm(st.blockMinutes)} block`);
  if (st.deadheadMinutes > 0) parts.push(`${hm(st.deadheadMinutes)} deadhead`);
  if (st.landings > 0) parts.push(`${st.landings} landing${st.landings === 1 ? "" : "s"}`);
  if (st.restDay) parts.push("a full day at the hotel");
  // A time overseas can fall on another local date than this home-calendar day: say which.
  if (day.dutyStartLocalDate) parts.push(`duty starts ${shortDate(day.dutyStartLocalDate)} local`);
  if (day.releaseLocalDate) parts.push(`lands ${shortDate(day.releaseLocalDate)} local`);
  if (parts.length === 0) return null;
  return <p className="mt-1 font-mono text-2xs text-readout">{parts.join(" · ")}</p>;
}

/** A trip's tail on a day the grid gives to something else: the end of one trip on the day the next one starts, or a landing just after midnight on a day off. */
function SpillList({ spill, offDay, mode }: { spill: NonNullable<DetailedDay["spill"]>; offDay: boolean; mode: TimeMode }) {
  const c = clockOf(mode);
  return (
    <div className="mt-1.5">
      <p>
        {offDay
          ? `Trip ${spill.tripNumber ? `#${spill.tripNumber} ` : ""}finishes on this day${spill.landsAt ? `, landing ${spill.landsAt} (${c})` : ""} — the bid pack still counts it as a day off.`
          : `Trip ${spill.tripNumber ? `#${spill.tripNumber} ` : ""}also finishes on this day${spill.landsAt ? `, landing ${spill.landsAt} (${c})` : ""}:`}
      </p>
      <ul className="mt-1 space-y-1">
        {spill.segments
          .filter((s) => s.kind !== "connection")
          .map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-sm ${STRIP_CLASS[s.kind]}`} />
              <span>
                <span className="font-medium text-ink">{s.label}</span>
                {s.detail ? <span> — {s.detail}</span> : null}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function DayDetail({ day, mode, heatOf }: { day: DetailedDay; mode: TimeMode; heatOf?: HeatOf }) {
  // The Heat Map's reasons for each duty period and layover drawn on the day, first: what a tap is for there.
  const heatPieces = heatPiecesOn([...(day.spill?.segments ?? []), ...(day.kind === "off" ? [] : day.segments)], heatOf);
  return (
    <div className="mt-2 rounded-lg border border-hairline bg-canvas/70 p-3 text-xs leading-relaxed text-ink-muted" aria-live="polite">
      <div className="flex items-center gap-1.5 font-medium text-ink">
        {day.title.split(" — ")[0]}
        {day.layoverCode && (
          <span className="inline-flex items-center gap-1 rounded-[3px] bg-good/15 px-1.5 py-px font-mono text-2xs font-semibold text-good">
            <BedIcon className="h-3 w-3" />
            {day.layoverCode}
            {day.layoverRest ? ` · ${day.layoverRest}` : ""}
          </span>
        )}
      </div>
      <HeatReasons pieces={heatPieces} className="mt-1.5 border-b border-hairline pb-2" />
      {day.kind === "off" ? (
        <>
          <p className="mt-1">
            A day off
            {day.offRun && day.offRun.length > 1 ? ` — day ${day.offRun.position} of ${day.offRun.length} in a row.` : " — a single day, on either side of a trip."}
          </p>
          {day.homeNote && <p className="mt-1 text-ink">{day.homeNote}</p>}
          {day.spill && <SpillList spill={day.spill} offDay mode={mode} />}
        </>
      ) : day.preReportTime !== null ? (
        <p className="mt-1">
          Not a day off: {day.tripNumber ? `trip #${day.tripNumber}` : "the next trip"} reports
          {day.preReportTime ? ` at ${day.preReportTime} (${clockOf(mode)})` : ""} the next morning, so the bid pack gives this evening to it.
        </p>
      ) : (
        <>
          {day.chain && <p className="mt-1 text-ink">{chainSentence(day.chain, mode)}</p>}
          {day.baseNote && <p className="mt-1 text-ink">{day.baseNote}</p>}
          {day.hubNote && <p className="mt-1 text-ink">{day.hubNote}</p>}
          {day.homeNote && <p className="mt-1 text-ink">{day.homeNote}</p>}
          {day.fullDay && (
            <p className="mt-1 text-ink">
              A full day in {day.fullDay.city}: in the hotel the night before, the whole day free, and a full night after
              {day.fullDay.barely ? " — just barely, up before 6 the next morning." : "."}
            </p>
          )}
          <p className="mt-1">
            {day.tripNumber ? `Trip #${day.tripNumber}` : "Trip"}, day {day.tripDay} of {day.tripDayCount}
            {day.tripCreditHours !== null ? ` · ${hm(day.tripCreditHours * 60)} credit for the trip` : ""}.
          </p>
          {day.kind !== "estimated" && <DayNumbers day={day} mode={mode} />}
          {day.kind === "estimated" ? (
            <p className="mt-1">Exact daily detail isn&rsquo;t available for this line.</p>
          ) : day.segments.length === 0 ? (
            <p className="mt-1">Nothing is scheduled on this day — the bid pack keeps it with the trip rather than counting it as a day off.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {day.segments
                .filter((s) => s.kind !== "connection")
                .map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-sm ${STRIP_CLASS[s.kind]}`} />
                    <span>
                      <span className="font-medium text-ink">{s.label}</span>
                      {s.detail ? <span> — {s.detail}</span> : null}
                      {s.leg && equipmentLabel(s.leg.equipment, s.leg.deadhead) ? <span className="font-mono"> · {equipmentLabel(s.leg.equipment, s.leg.deadhead)}</span> : null}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {day.spill && <SpillList spill={day.spill} offDay={false} mode={mode} />}
          {(day.redEye || day.earlyReport || day.layoverInternational || day.citySentiment) && (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {day.redEye && <span className="text-accent">Night leg: a flight departs or lands between midnight and 5am.</span>}
              {day.earlyReport && <span className="text-warn">Early report: duty starts in the 2–6am window{mode === "zulu" ? ", local time" : ""}.</span>}
              {day.layoverInternational && <span>International layover.</span>}
              {day.citySentiment === "love" && <span className="text-good">{day.layoverCode} is a city you love.</span>}
              {day.citySentiment === "avoid" && <span className="text-danger">{day.layoverCode} is a city you avoid.</span>}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Each run of days off, said: "7 and 7", "10, 3 and 5". */
export function fmtRuns(runs: number[]): string {
  if (runs.length === 0) return "none";
  if (runs.length === 1) return String(runs[0]);
  return `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`;
}

/**
 * One fact: its name on the left, the value beside it, every row on the same two columns so the box reads as one list.
 * Where both won't fit side by side (a phone with its text set larger) the value goes under its name: a fixed name column
 * left the value a few pixels at 200% text, one letter a row.
 */
function Row({ label, children, tone = "", labelTone = "text-ink-faint", full = false }: { label: ReactNode; children: ReactNode; tone?: string; labelTone?: string; full?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-wrap items-baseline gap-x-2 ${full ? "sm:col-span-2" : ""}`}>
      {/* Wraps rather than cutting off: at 200% text "Days off in a row" lost its last words. */}
      <dt className={`w-[7.25rem] max-w-full shrink-0 text-2xs font-medium ${labelTone}`}>{label}</dt>
      <dd className={`min-w-0 flex-1 basis-24 break-words font-mono text-xs font-medium ${tone || "text-readout"}`}>{children}</dd>
    </div>
  );
}

function Summary({ s, line, bodyClock }: { s: MonthSummary; line: Line; bodyClock: BodyClockScore | null }) {
  const cities = s.cities.slice(0, 5);
  const [whyOpen, setWhyOpen] = useState(false);
  return (
    <dl className="mt-2 grid grid-cols-1 gap-y-1 rounded-lg border border-hairline bg-canvas/70 px-3 py-2 sm:grid-cols-2 sm:gap-x-6">
      {/* Duty periods, landings and time away are already on the card above, so this space goes to what isn't. */}
      <Row label="Trips">{`${line.trips.length}${s.departures < line.trips.length ? ` · ${s.departures} departures` : ""} · longest ${s.longestTripDays}d`}</Row>
      <Row label="Days off in a row">{fmtRuns(s.offRuns)}</Row>
      <Row label="Weekends off">{s.weekendsTotal > 0 ? `${s.weekendsOff} of ${s.weekendsTotal}` : "—"}</Row>
      {/* A line of nothing but hotel standby prints BLK. 0:00, and its strip says so: "—" read as not known. */}
      <Row label="Block hours">{line.totalBlockHours !== undefined ? hm(line.totalBlockHours * 60) : "—"}</Row>
      <Row label="Hotel standby" tone={s.standbyDays > 0 ? "text-standby" : ""}>
        {s.standbyDays > 0 ? `${s.standbyDays} day${s.standbyDays === 1 ? "" : "s"}` : "none"}
      </Row>
      {/* The body clock: one score, and under it why — the line's report and landing times among the reasons. */}
      {bodyClock && (
        // A container, so the badge can put its score under its name in a cell this narrow (see `BodyClockBadge`).
        <div className="@container min-w-0">
          <dt className="sr-only">Body clock</dt>
          <dd>
            <BodyClockBadge result={bodyClock} open={whyOpen} onClick={() => setWhyOpen((o) => !o)} />
          </dd>
        </div>
      )}
      {bodyClock && whyOpen && (
        <div className="rounded-md border border-hairline bg-surface/70 px-3 py-2 sm:col-span-2">
          <BodyClockReasons
            result={bodyClock}
            facts={
              <>
                <BodyClockFact label="Earliest duty start" value={s.earliestDutyStart ? `${s.earliestDutyStart} (L)` : "—"} tone={s.earlyReportDays > 0 ? "text-warn" : ""} />
                <BodyClockFact label="Latest landing" value={s.latestRelease ? `${s.latestRelease} (L)` : "—"} />
                <BodyClockFact label="Early reports" value={String(s.earlyReportDays)} tone={s.earlyReportDays > 0 ? "text-warn" : ""} />
              </>
            }
          />
        </div>
      )}
      {s.base && (
        <Row full label="Commuting">
          {s.base.commutes} {s.base.code} commute{s.base.commutes === 1 ? "" : "s"} · {s.base.nights === 0 ? `no nights in ${s.base.code}` : `${s.base.nights} night${s.base.nights === 1 ? "" : "s"} in ${s.base.code}`}
          {s.base.jumpseatIns > 0 ? ` · ${s.base.jumpseatIns} jumpseat-in${s.base.jumpseatIns === 1 ? "" : "s"}` : ""}
        </Row>
      )}
      {s.home && (
        <Row full label="At home">
          {s.home.between.length ? `${s.home.between.map((b) => `${Math.round(b.hours)}h`).join(", ")} between departures · ` : ""}
          {s.home.nightsHome} night{s.home.nightsHome === 1 ? "" : "s"} in your own bed
          {s.home.shortGaps > 0 ? <span className="text-warn">{` · ${s.home.shortGaps} short stay${s.home.shortGaps === 1 ? "" : "s"} (under ${s.home.minBreakNights} nights)`}</span> : ""}
        </Row>
      )}
      {s.hubTurns && (
        <Row full label="Hub turns">
          {s.hubTurns.all} at {s.hubTurns.hubs.join(", ")}
          {s.hubTurns.night ? ` · ${s.hubTurns.night === s.hubTurns.all ? "all" : s.hubTurns.night} at night` : " · by day"}
          {s.hubTurns.longestRun > 1 ? ` · up to ${s.hubTurns.longestRun} nights in a row` : ""}
          {s.hubTurns.withRestHotel ? ` · ${s.hubTurns.withRestHotel} with a crew-rest hotel` : ""}
        </Row>
      )}
      {s.carryOver && (
        <Row full label={`Into ${s.carryOver.month}`} labelTone="text-carry">
          {s.carryOver.days} day{s.carryOver.days === 1 ? "" : "s"}
          {s.carryOver.dutyPeriods > 0 ? ` · ${s.carryOver.dutyPeriods} duty period${s.carryOver.dutyPeriods === 1 ? "" : "s"}` : ""}
          {s.carryOver.landings > 0 ? ` · ${s.carryOver.landings} landing${s.carryOver.landings === 1 ? "" : "s"}` : ""}
          {s.carryOver.creditHours > 0 ? ` · ${hm(s.carryOver.creditHours * 60)} C/O credit` : ""}
          {s.carryOver.blockHours > 0 ? ` · ${hm(s.carryOver.blockHours * 60)} C/O block` : ""}
          <span className="font-sans font-normal text-ink-faint"> · not counted in this month</span>
        </Row>
      )}
      <Row full label="Layovers">
        <span className="font-sans font-normal text-ink-muted">
          {s.layoverNights} night{s.layoverNights === 1 ? "" : "s"}
          {s.internationalLayoverNights > 0 ? `, ${s.internationalLayoverNights} international` : ""}
          {s.fullDays > 0 ? `, ${s.fullDays} full day${s.fullDays === 1 ? "" : "s"}` : ""}
          {cities.length ? " · " : ""}
        </span>
        <span className="inline-flex flex-wrap gap-x-2.5 gap-y-0.5 font-sans text-ink">
          {cities.length === 0 && <span className="text-ink-muted">none</span>}
          {cities.map((c) => (
            <span key={c.code} className="inline-flex items-center gap-0.5">
              {c.code}
              {c.nights > 1 && <span className="font-normal text-ink-muted">×{c.nights}</span>}
              <CityMarkGlyph mark={c.sentiment} />
            </span>
          ))}
          {s.cities.length > cities.length && <span className="font-normal text-ink-muted">+{s.cities.length - cities.length} more</span>}
        </span>
      </Row>
      {s.daysOff !== s.printedDaysOff && (
        <div className="text-2xs leading-snug text-ink-faint sm:col-span-2">
          <dt className="sr-only">Note</dt>
          <dd>
            The bid pack prints {s.printedDaysOff} days off for this line; the calendar draws {s.daysOff} from the trips&rsquo; dates, so a day at either end of a trip can differ.
          </dd>
        </div>
      )}
    </dl>
  );
}

interface MiniLinePreviewProps {
  line: Line;
  /** Kept for API parity with the detailed calendar's own props — the month grid doesn't need a timezone offset. */
  homeBaseOffsetMinutes?: number | null;
  bidPeriodStart: string | null;
  bidPeriodDays: number;
  /** Whether to print the legend under this grid. Default true; a list of many grids turns it off and shows one `MonthLegend` above them all. */
  showLegend?: boolean;
  /** The pilot's own loved/avoided layover cities, so a layover day can say how they feel about it. */
  cityPreferences?: Record<string, CityMark>;
  /** The base and where the pilot lives, so trips are joined into the same departures the scores count. */
  departureOptions?: MonthDepartureOptions;
  /** Just the month (the interview's line cards): its four or five weeks, no carry-over days, no summary or legend under it. */
  compact?: boolean;
  /** The Heat Map, trip by trip (`tripHeatsOf`): the days' duty periods and layovers in their heat colours. */
  heat?: Map<number, TripHeat> | null;
  /** The pilot's vacation on this line: its days ringed gold, the days it could slide to hatched (`lib/vacation-marks.ts`). */
  vacation?: LineVacationMark | null;
}

/** What a calendar day is to the pilot's vacation: on it (and its first day, for "VAC 7"), where the pack had it, or a day it could slide to. */
interface VacationDay {
  on: boolean;
  first: number | null;
  awarded: boolean;
  reach: boolean;
}

function vacationDays(mark: LineVacationMark | null | undefined): Map<number, VacationDay> {
  const out = new Map<number, VacationDay>();
  const at = (d: number) => out.get(d) ?? out.set(d, { on: false, first: null, awarded: false, reach: false }).get(d)!;
  for (const p of mark?.pieces ?? []) {
    const { before, after } = reachSpans(p);
    // The whole days it could slide over, counted out from its first day back or its last day on.
    const run = (r: [number, number] | null, from: number, dir: 1 | -1) => (r ? Array.from({ length: Math.round((r[1] - r[0]) / 1440) }, (_, k) => from + dir * (k + 1)) : []);
    for (const d of [...run(before, p.firstDay, -1), ...run(after, p.lastDay, 1)]) at(d).reach = true;
    if (p.firstDay !== p.awardedFirstDay) for (let d = p.awardedFirstDay; d <= p.awardedLastDay; d++) at(d).awarded = true;
    for (let d = p.firstDay; d <= p.lastDay; d++) at(d).on = true;
    at(p.firstDay).first = p.days;
  }
  return out;
}

export const MiniLinePreview = memo(function MiniLinePreview({
  line,
  bidPeriodStart,
  bidPeriodDays,
  showLegend = true,
  cityPreferences,
  departureOptions,
  compact = false,
  homeBaseOffsetMinutes = null,
  heat = null,
  vacation = null,
}: MiniLinePreviewProps) {
  const [chosenMode, setMode] = useTimeMode();
  // The interview's small line cards stay on the base's calendar.
  const mode: TimeMode = compact ? "local" : chosenMode;
  const month: DetailedMonth = useMemo(() => {
    const built = buildDetailedMonth(line, bidPeriodStart, bidPeriodDays, cityPreferences, departureOptions, mode);
    // The interview's cards show the bid month alone; what carries into the next is said as the line's C/O.
    return compact ? { ...built, days: built.days.filter((d) => !d.nextMonth) } : built;
  }, [line, bidPeriodStart, bidPeriodDays, cityPreferences, departureOptions, mode, compact]);
  const [selected, setSelected] = useState<number | null>(null);
  // The month lays itself out the first time it scrolls into view (see
  // .cal-grid in globals.css) — not before, so a long list doesn't spend its
  // animation on cards nobody has reached yet.
  const [gridRef, gridWidth] = useMeasuredWidth<HTMLDivElement>(560);
  // Starts just before it scrolls on screen, so the build is under way by the time it's seen.
  const revealed = useInView(gridRef, { once: true, margin: "0px 0px 10% 0px" });
  // Seven days and six gaps across the grid, less each day's own padding.
  const barWidth = Math.max(0, (gridWidth - 6 * 4) / 7 - 8);
  // Each layover's words go on its longest day, counted across the whole month — a stay runs over several days.
  // The line's body clock as the ranking scores it: its trips whole — a run of nights going on into the next month weighs all the same.
  const bodyClock = useMemo(() => (compact ? null : lineBodyClockScore(line.trips, homeBaseOffsetMinutes)), [compact, line.trips, homeBaseOffsetMinutes]);
  const stayLabeled = useMemo(() => {
    const labeled = labeledStayPieces(month.days.map((d) => [...(d.spill?.segments ?? []), ...(d.kind === "off" ? [] : d.segments)]));
    return (s: TimelineSegment) => labeled.has(s);
  }, [month]);

  // On the domicile's days only: in Zulu a day isn't the one the vacation's dates are.
  const vacDays = mode === "local" ? vacationDays(vacation) : new Map<number, VacationDay>();
  if (line.trips.length === 0) return null;
  const selectedDay = selected !== null ? month.days[selected] : null;
  const heatOfDay = (day: DetailedDay) => heatOfTrips(heat, day.tripIndex, day.spill ? { trip: day.spill.tripIndex, segments: day.spill.segments } : null);

  return (
    <div>
      {!compact && (
        // Zulu/Local goes under the words where both won't fit: at 200% text on a 320 px phone it ran off the side.
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <span className="min-w-0 flex-1 basis-24 text-2xs leading-tight text-ink-faint">
            {mode === "zulu" ? "Zulu days, midnight to midnight Z · times Z" : `${departureOptions?.base ? `${departureOptions.base}'s` : "The domicile's"} calendar days · times local`}
          </span>
          <TimeModeToggle mode={mode} onChange={setMode} />
        </div>
      )}
      {!compact && (heat ? <HeatKey className="mb-1.5" /> : <ColorKey variant="calendar" className="mb-1.5" />)}
      <div role="group" aria-label={`Bid month at a glance${mode === "zulu" ? ", in Zulu" : ""}. ${month.summary.daysOff} days off, ${month.summary.dutyPeriods} duty periods.`}>
        {/* The weekday names grow with the text up to 150%: at 200% "Mon" ran into "Tue" over a phone's narrow days. And
            no bigger than a day holds ("Wed" is about 2.2 of its size wide): at 150% on a 320 phone they still ran together. */}
        {month.weekdayHeaders && (
          <div className="mb-1 grid grid-cols-7 gap-[4px] text-center leading-4 font-medium text-ink-faint" style={{ fontSize: `min(var(--text-2xs), 16.5px, ${((gridWidth - 6 * 4) / 7 / 2.2).toFixed(1)}px)` }} aria-hidden>
            {month.weekdayHeaders.map((d) => (
              <span key={d} className={d === "Sat" || d === "Sun" ? "text-ink-muted" : ""}>{d}</span>
            ))}
          </div>
        )}
        {/* The gap in px, as `barWidth` and the day's padding are (see `cellClass`). */}
        <div ref={gridRef} className={`cal-grid grid grid-cols-7 gap-[4px] ${revealed ? "is-revealed" : ""}`}>
          {month.days.map((day, i) => (
            <Cell
              key={day.dayIndex}
              index={i}
              day={day}
              joinLeft={i % 7 !== 0 && (day.chain !== null || (!day.isTripStart && month.days[i - 1]?.tripIndex === day.tripIndex && month.days[i - 1]?.kind !== "off"))}
              joinRight={i % 7 !== 6 && (month.days[i + 1]?.chain != null || (!day.isTripEnd && month.days[i + 1]?.tripIndex === day.tripIndex && month.days[i + 1]?.kind !== "off"))}
              selected={selected === day.dayIndex}
              barWidth={barWidth}
              stayLabeled={stayLabeled}
              cityPreferences={cityPreferences}
              mode={mode}
              heatOf={heatOfDay(day)}
              vacation={vacDays.get(day.dayIndex) ?? null}
              onSelect={() => setSelected((cur) => (cur === day.dayIndex ? null : day.dayIndex))}
            />
          ))}
        </div>
      </div>

      {selectedDay ? <DayDetail day={selectedDay} mode={mode} heatOf={heatOfDay(selectedDay)} /> : <p className="mt-1.5 text-2xs text-ink-faint print:hidden">Tap a day for everything on it.</p>}

      {!compact && <Summary s={month.summary} line={line} bodyClock={bodyClock} />}

      {showLegend && !compact && <MonthLegend className="mt-2" />}

      {!month.placementIsReal && (
        <p className="mt-1.5 text-xs text-ink-faint">
          Trip lengths and total days off are exact, but this line&rsquo;s exact dates couldn&rsquo;t be confirmed, so trips are shown in order rather than on verified dates.
        </p>
      )}
    </div>
  );
});
