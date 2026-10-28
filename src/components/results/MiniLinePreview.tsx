"use client";

import { useInView } from "motion/react";
import { memo, useMemo, useState } from "react";
import { BedIcon } from "@/components/ui/icons";
import { LegBars, useMeasuredWidth } from "@/components/results/LegBars";
import { Modal } from "@/components/ui/Modal";
import { buildDetailedMonth, type DetailedDay, type DetailedMonth, type MonthDepartureOptions, type MonthSummary, type TripFinish } from "@/lib/month-detail";
import { dayStats, equipmentLabel, hm } from "@/lib/trip-day-stats";
import type { TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { CityMark } from "@/types/preferences";

/**
 * The whole bid month for one line, as much of it as a card can carry: each
 * day shows its trip's own number and credit, when the duty starts (and when
 * the trip ends), its flights drawn as the ex-pilot drew them in his paper
 * organizer — a line per leg, to scale and placed by the time of day, the
 * cities under its ends (`LegBars`) — and the layover city, marked with how
 * the pilot feels about it. Tapping a day opens everything the bid pack says about it below
 * the grid; a strip under it sums the month up in the terms the interview
 * asks about (days off and how they fall, standby, report times, cities…).
 * Each trip, day by day in the same picture, is in the expanded card.
 */

/** The same palette as the trip chart in the expanded card, so a day's strip and its column there read as one thing. */
const STRIP_CLASS: Record<TimelineSegmentKind, string> = {
  flying: "bg-calendar-accent",
  deadhead: "hatch-deadhead bg-calendar-accent/30",
  standby: "bg-standby",
  layover: "bg-good/70",
  ground: "bg-accent/70",
  connection: "bg-border-strong",
  sleep: "bg-sleep",
};

function cellClass(day: DetailedDay, selected: boolean): string {
  const base =
    "@container relative flex min-h-[4.75rem] min-w-0 flex-col justify-between gap-0.5 rounded-md p-1 text-left leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:min-h-[6.25rem]";
  const ring = selected ? " ring-2 ring-brand ring-offset-1 ring-offset-surface" : "";
  switch (day.kind) {
    case "off":
      return `${base} border border-dashed ${day.isWeekend ? "border-border-strong/70 bg-surface-raised/40" : "border-border-strong/40"} text-ink-faint hover:border-ink-faint${ring}`;
    case "standby":
      return `${base} bg-standby/20 text-ink hover:bg-standby/30${ring}`;
    case "estimated":
      return `${base} bg-brand-soft text-brand${ring}`;
    default:
      // Every day of a trip shares one tint, so a trip reads as one block; what each day holds is printed on it.
      return `${base} bg-calendar-accent/[0.13] text-ink hover:bg-calendar-accent/[0.22]${ring}`;
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

/** "27h40m" → "27h": the layover's length at a glance. */
const shortRest = (rest: string) => rest.replace(/h\d+m$/, "h");

/** 107 → "1h47": time on the ground between two chained trips. */
const turnLabel = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

/** Turns this short are a straight turn at base; longer, the pilot is sitting at base between trips because home is too far to be worth it. */
const STRAIGHT_TURN_MINUTES = 6 * 60;

/** What joining two trips means for this pilot, in a sentence. */
function chainSentence(c: NonNullable<DetailedDay["chain"]>): string {
  const times = c.landed && c.reports ? `: lands ${c.city} ${c.landed}, reports again ${c.reports} (L)` : "";
  return c.turnMinutes < STRAIGHT_TURN_MINUTES
    ? `Turns straight out of trip #${c.fromTripNumber ?? ""}${times} — ${turnLabel(c.turnMinutes)} on the ground, so the two are flown as one departure from home.`
    : `Follows trip #${c.fromTripNumber ?? ""} after ${turnLabel(c.turnMinutes)} in ${c.city}${times}. That's not long enough to get home and have 24 hours there, so the two are one departure — and the time between is spent in ${c.city}.`;
}

/** "17.8" credit hours → "17:47", the way the bid pack prints a trip's credit under its number. */
const creditClock = (h: number) => hm(Math.round(h * 60));

/** Where the night is spent: the layover city and how long, marked with how the pilot feels about it. */
function Sleep({ day }: { day: DetailedDay }) {
  const city = day.layoverCode ?? day.restCity;
  if (!city) return null;
  return (
    <span className="flex min-w-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold tracking-tight text-good">
      <BedIcon className="hidden h-2.5 w-2.5 shrink-0 @min-[4.75rem]:block" />
      <span className={day.layoverInternational ? "underline decoration-dotted underline-offset-2" : ""}>{city}</span>
      {day.layoverRest ? (
        <span className="hidden font-mono text-[10px] font-normal @min-[4.75rem]:inline">{shortRest(day.layoverRest)}</span>
      ) : (
        !day.layoverCode && <span className="hidden text-[10px] font-normal @min-[4.75rem]:inline">rest</span>
      )}
      <CityMarkGlyph mark={day.citySentiment} />
    </span>
  );
}

/** Where and when the trip lands, on its own last day — "MEM 00:56 +1" when that's after midnight. */
function Finish({ finish }: { finish: TripFinish }) {
  return (
    <span className="flex min-w-0 items-baseline gap-0.5 whitespace-nowrap font-mono text-[10px] text-ink" title={`Lands ${finish.city} ${finish.time} (L)${finish.nextDay ? ", just after midnight" : ""}`}>
      <span aria-hidden className="text-ink-faint">↘</span>
      <span className="font-semibold">{finish.city}</span>
      <span className="hidden @min-[4.75rem]:inline">{finish.time}</span>
      {finish.nextDay && <span className="text-[8.5px] text-ink-muted">+1</span>}
    </span>
  );
}

/**
 * One day of the month: the trip's number and credit on its first day and when it reports, the day's flights as bars
 * with their cities, where the night is spent, and where the trip lands on its last day. Times stay out of the way —
 * the report and the landing; tap the day for every flight and time. Too narrow for the cities (a phone), the bars
 * alone.
 */
function Cell({
  day,
  selected,
  onSelect,
  index,
  joinLeft,
  joinRight,
  barWidth,
}: {
  day: DetailedDay;
  selected: boolean;
  onSelect: () => void;
  index: number;
  joinLeft: boolean;
  joinRight: boolean;
  /** The width the day's bars are drawn at. */
  barWidth: number;
}) {
  const isOff = day.kind === "off";
  const standby = day.flights.find((f) => f.kind === "standby");
  // The end of another trip that morning (a landing just after midnight), then this day's own.
  const pieces = [...(day.spill?.segments ?? []), ...(isOff ? [] : day.segments)];
  const bars = pieces.some((s) => s.kind === "flying" || s.kind === "deadhead" || s.kind === "standby") ? (
    <LegBars segments={pieces} variant="cell" widthPx={barWidth} />
  ) : null;
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
      <span className="flex items-start justify-between gap-0.5">
        <span className={`text-[11px] tabular-nums ${isOff ? "" : "font-semibold"}`}>{day.label}</span>
        {day.isTripStart && day.tripNumber && (
          <span className="hidden whitespace-nowrap rounded bg-calendar-accent px-0.5 font-mono text-[10px] font-semibold text-on-calendar @min-[4.75rem]:inline">
            #{day.tripNumber}
            {day.tripCreditHours !== null && <span className="hidden font-normal opacity-80 @min-[5rem]:inline"> {creditClock(day.tripCreditHours)}</span>}
          </span>
        )}
      </span>

      {isOff ? (
        <>
        {bars}
        <span className="text-[10px] font-medium leading-tight">
          {day.offRun && day.offRun.length > 1 && day.offRun.isFirst ? (
            <>
              {day.offRun.length}
              <span className="hidden @min-[4.75rem]:inline"> days</span> off
            </>
          ) : (
            ""
          )}
        </span>
        </>
      ) : (
        <>
          {/* On a phone the cell is too narrow for the trip number beside the date, so it sits on its own line. */}
          {day.isTripStart && day.tripNumber && <span className="font-mono text-[10px] font-semibold leading-tight text-ink @min-[4.75rem]:hidden">#{day.tripNumber}</span>}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
            {day.chain ? (
              <span className="hidden whitespace-nowrap font-mono text-[10px] leading-tight @min-[4.75rem]:block" title={chainSentence(day.chain)}>
                <span className={day.earlyReport ? "font-semibold text-warn" : "text-ink-muted"}>Rpt {day.chain.reports || day.dutyStart}</span>
                <span className="hidden text-calendar-accent @min-[8.5rem]:inline"> · {turnLabel(day.chain.turnMinutes)} turn</span>
              </span>
            ) : (
              day.isTripStart &&
              day.dutyStart && (
                <span className={`hidden whitespace-nowrap font-mono text-[10px] leading-tight @min-[4.75rem]:block ${day.earlyReport ? "font-semibold text-warn" : "text-ink-muted"}`}>
                  Rpt {day.dutyStart}
                </span>
              )
            )}
            {day.preReportTime !== null && <span className="hidden text-[10px] leading-tight text-ink-muted @min-[4.75rem]:block">reports next morning</span>}
            {bars}
            {standby && (
              <span className="whitespace-nowrap font-mono text-[10px] font-semibold text-standby">
                SBY<span className="hidden @min-[3.25rem]:inline"> {standby.from}</span>
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <Sleep day={day} />
            {day.finish && <Finish finish={day.finish} />}
          </span>
        </>
      )}
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
            <li><span className="font-medium text-ink">Each week reads like a line in the bid pack.</span> Shaded days joined by a bar are one trip. Its first day carries the trip&rsquo;s number and credit (<span className="font-mono">#111 17:47</span>) and when it reports (<span className="font-mono">Rpt 06:30</span>, in amber when it&rsquo;s between 2 and 6am).</li>
            <li><span className="font-medium text-ink">The lines in each day.</span> Each flight is a line with a tick at each end, as long as the flight and placed by the time of day &mdash; midnight at the left edge, midnight at the right, on the base&rsquo;s clock. The cities are written under the ends; where two legs meet, the city between them is written once. A dashed line is a deadhead. A flight still in the air at midnight runs off the right edge (▸) and on into the next day. The faint band under the lines is the time on duty, report to release, so a long wait between two short flights shows. Small ticks mark 6am, noon and 6pm.</li>
            <li><span className="font-medium text-ink">Trips joined into one bar.</span> Trips flown without going home in between &mdash; one departure. For a commuter that&rsquo;s whenever there wouldn&rsquo;t be 24 hours at home between them, counting the trip home and back (<span className="font-mono">Rpt 02:30 · 1h47 turn</span> is a straight turn at base). For a pilot who lives at base, only trips that turn within a few hours.</li>
            <li><span className="font-medium text-ink">Green city.</span> Where you sleep and how long the layover is (<span className="font-mono">SEA 15h</span>). <span className="font-mono">KIX rest</span> is a whole day at the hotel with nothing flown. <span className="text-good">♥</span> is a city you love, <span className="text-good">♡</span> one you like, an amber <span className="text-warn">✕</span> one you dislike and a red <span className="text-danger">✕</span> one you avoid, and a dotted underline marks an international city.</li>
            <li><span className="font-medium text-ink">↘ MEM 19:05.</span> Where and when the trip lands, on its last day. <span className="font-mono">+1</span> means just after midnight &mdash; the bid pack still counts the next day as off.</li>
            <li><span className="font-medium text-ink">Violet day.</span> Hotel standby (<span className="font-mono">SBY</span>) &mdash; on call at the hotel, paid, not flying.</li>
            <li><span className="font-medium text-ink">Dashed empty day.</span> A day off; a run of them is labeled on its first day (&ldquo;4 days off&rdquo;).</li>
            <li><span className="font-medium text-ink">Tap any day</span> for every flight with its times and aircraft, the hotel and rest, block time and landings. Every time is local (L). The hour-by-hour chart for each trip is under &ldquo;Details&rdquo;.</li>
          </ul>
        </Modal>
      )}
    </>
  );
}

/** A leg as the calendar draws it, for the legend: a line with a tick at each end — dashed for a deadhead. */
export function LegSample({ deadhead = false }: { deadhead?: boolean }) {
  const tone = deadhead ? "bg-ink-muted" : "bg-ink";
  return (
    <span aria-hidden className="relative inline-block h-2.5 w-6 shrink-0 align-middle">
      <span className={`absolute left-0 top-0 h-full w-[1.5px] ${tone}`} />
      <span className={`absolute inset-x-0 top-1/2 -mt-px ${deadhead ? "border-t-2 border-dashed border-ink-muted" : "h-0.5 bg-ink"}`} />
      <span className={`absolute right-0 top-0 h-full w-[1.5px] ${tone}`} />
    </span>
  );
}

/** The key to every month grid on the page — shown once above a list of them rather than under each one, and under each one only where a grid stands alone (the comparison view). */
export function MonthLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted ${className}`}>
      <span className="inline-flex items-center gap-1"><span className="rounded bg-calendar-accent px-0.5 font-mono text-[10px] font-semibold text-on-calendar">#111 17:47</span>Trip and its credit</span>
      <span className="inline-flex items-center gap-1.5"><LegSample />Flight, to scale, midnight to midnight</span>
      <span className="inline-flex items-center gap-1.5"><LegSample deadhead />Deadhead</span>
      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-5 rounded-[2px] bg-calendar-accent/20" />On duty</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px] font-semibold text-good">SEA 15h</span>Where you sleep</span>
      <span className="inline-flex items-center gap-1"><span className="text-good">♥</span>love <span className="text-good">♡</span>like <span className="text-warn">✕</span>dislike</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px]"><span className="text-ink-faint">↘</span><span className="font-semibold">MEM</span> 00:56<span className="text-[9px] text-ink-muted">+1</span></span>Lands</span>
      <LegendItem swatch="bg-standby/25 border-t-2 border-standby" label="Hotel standby" />
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

function DayNumbers({ day }: { day: DetailedDay }) {
  const st = dayStats({ dayNumber: day.tripDay ?? 1, segments: day.segments });
  const parts: string[] = [];
  // In time order, one phrase per duty — a day can finish last night's flying and start tonight's.
  for (const w of st.windows) {
    if (w.start && w.end) parts.push(`on duty ${w.start}–${w.end} (L)`);
    else if (w.end) parts.push(`lands ${w.end} (L) from the night before`);
    else if (w.start) parts.push(`on duty ${w.start} (L), through midnight`);
  }
  if (st.blockMinutes > 0) parts.push(`${hm(st.blockMinutes)} block`);
  if (st.deadheadMinutes > 0) parts.push(`${hm(st.deadheadMinutes)} deadhead`);
  if (st.landings > 0) parts.push(`${st.landings} landing${st.landings === 1 ? "" : "s"}`);
  if (st.restDay) parts.push("a full day at the hotel");
  // A time overseas can fall on another local date than this home-calendar day: say which.
  if (day.dutyStartLocalDate) parts.push(`duty starts ${shortDate(day.dutyStartLocalDate)} local`);
  if (day.releaseLocalDate) parts.push(`lands ${shortDate(day.releaseLocalDate)} local`);
  if (parts.length === 0) return null;
  return <p className="mt-1 font-mono text-[11px] text-readout">{parts.join(" · ")}</p>;
}

/** A trip's tail on a day the grid gives to something else: the end of one trip on the day the next one starts, or a landing just after midnight on a day off. */
function SpillList({ spill, offDay }: { spill: NonNullable<DetailedDay["spill"]>; offDay: boolean }) {
  return (
    <div className="mt-1.5">
      <p>
        {offDay
          ? `Trip ${spill.tripNumber ? `#${spill.tripNumber} ` : ""}finishes on this day${spill.landsAt ? `, landing ${spill.landsAt} (L)` : ""} — the bid pack still counts it as a day off.`
          : `Trip ${spill.tripNumber ? `#${spill.tripNumber} ` : ""}also finishes on this day${spill.landsAt ? `, landing ${spill.landsAt} (L)` : ""}:`}
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

function DayDetail({ day }: { day: DetailedDay }) {
  return (
    <div className="mt-2 rounded-lg border border-hairline bg-canvas/70 p-3 text-xs leading-relaxed text-ink-muted" aria-live="polite">
      <div className="flex items-center gap-1.5 font-medium text-ink">
        {day.title.split(" — ")[0]}
        {day.layoverCode && (
          <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-1.5 py-px font-mono text-[10px] font-semibold text-good">
            <BedIcon className="h-3 w-3" />
            {day.layoverCode}
            {day.layoverRest ? ` · ${day.layoverRest}` : ""}
          </span>
        )}
      </div>
      {day.kind === "off" ? (
        <>
          <p className="mt-1">
            A day off
            {day.offRun && day.offRun.length > 1 ? ` — day ${day.offRun.position} of ${day.offRun.length} in a row.` : " — a single day, on either side of a trip."}
          </p>
          {day.homeNote && <p className="mt-1 text-ink">{day.homeNote}</p>}
          {day.spill && <SpillList spill={day.spill} offDay />}
        </>
      ) : day.preReportTime !== null ? (
        <p className="mt-1">
          Not a day off: {day.tripNumber ? `trip #${day.tripNumber}` : "the next trip"} reports
          {day.preReportTime ? ` at ${day.preReportTime} (L)` : ""} the next morning, so the bid pack gives this evening to it.
        </p>
      ) : (
        <>
          {day.chain && <p className="mt-1 text-ink">{chainSentence(day.chain)}</p>}
          {day.baseNote && <p className="mt-1 text-ink">{day.baseNote}</p>}
          {day.hubNote && <p className="mt-1 text-ink">{day.hubNote}</p>}
          {day.homeNote && <p className="mt-1 text-ink">{day.homeNote}</p>}
          <p className="mt-1">
            {day.tripNumber ? `Trip #${day.tripNumber}` : "Trip"}, day {day.tripDay} of {day.tripDayCount}
            {day.tripCreditHours !== null ? ` · ${hm(day.tripCreditHours * 60)} credit for the trip` : ""}.
          </p>
          {day.kind !== "estimated" && <DayNumbers day={day} />}
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
          {day.spill && <SpillList spill={day.spill} offDay={false} />}
          {(day.redEye || day.earlyReport || day.layoverInternational || day.citySentiment) && (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {day.redEye && <span className="text-accent">Red-eye: a flight departs or lands between midnight and 5am.</span>}
              {day.earlyReport && <span className="text-warn">Early report: duty starts in the 2–6am window.</span>}
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

function fmtRuns(runs: number[]): string {
  return runs.length === 0 ? "none" : runs.join(" · ");
}

function SummaryItem({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className={`break-words font-mono text-xs font-medium ${tone || "text-readout"}`}>{value}</dd>
    </div>
  );
}

function Summary({ s, line }: { s: MonthSummary; line: Line }) {
  const cities = s.cities.slice(0, 5);
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-hairline bg-canvas/70 px-3 py-2 sm:grid-cols-3">
      {/* Duty periods, landings and time away are already on the card above, so this space goes to what isn't. */}
      <SummaryItem label="Trips" value={`${line.trips.length}${s.departures < line.trips.length ? ` · ${s.departures} departures` : ""} · longest ${s.longestTripDays}d`} />
      <SummaryItem label="Days off in a row" value={`${fmtRuns(s.offRuns)}`} />
      <SummaryItem label="Weekends off" value={s.weekendsTotal > 0 ? `${s.weekendsOff} of ${s.weekendsTotal}` : "—"} />
      <SummaryItem label="Earliest duty start" value={s.earliestDutyStart ? `${s.earliestDutyStart} (L)` : "—"} tone={s.earlyReportDays > 0 ? "text-warn" : ""} />
      <SummaryItem label="Latest landing" value={s.latestRelease ? `${s.latestRelease} (L)` : "—"} />
      <SummaryItem label="Block hours" value={line.totalBlockHours ? hm(line.totalBlockHours * 60) : "—"} />
      <SummaryItem label="Red-eye days" value={String(s.redEyeDays)} tone={s.redEyeDays > 0 ? "text-accent" : ""} />
      <SummaryItem label="Early reports" value={String(s.earlyReportDays)} tone={s.earlyReportDays > 0 ? "text-warn" : ""} />
      <SummaryItem label="Hotel standby" value={s.standbyDays > 0 ? `${s.standbyDays} day${s.standbyDays === 1 ? "" : "s"}` : "none"} tone={s.standbyDays > 0 ? "text-standby" : ""} />
      {s.base && (
        <p className="col-span-2 font-mono text-xs text-readout sm:col-span-3">
          <span className="font-sans text-[10px] uppercase tracking-wide text-ink-faint">Commuting · </span>
          {s.base.commutes} {s.base.code} commute{s.base.commutes === 1 ? "" : "s"} · {s.base.nights === 0 ? `no nights in ${s.base.code}` : `${s.base.nights} night${s.base.nights === 1 ? "" : "s"} in ${s.base.code}`}
          {s.base.jumpseatIns > 0 ? ` · ${s.base.jumpseatIns} jumpseat-in${s.base.jumpseatIns === 1 ? "" : "s"}` : ""}
        </p>
      )}
      {s.pastMonthEnd && (
        <p className="col-span-2 font-mono text-xs text-readout sm:col-span-3">
          <span className="font-sans text-[10px] uppercase tracking-wide text-ink-faint">Five-week line · </span>
          flies {s.pastMonthEnd.days} day{s.pastMonthEnd.days === 1 ? "" : "s"} past the bid month, to {s.pastMonthEnd.lastLanding} · departures judged over the longer month
        </p>
      )}
      {s.home && (
        <p className="col-span-2 font-mono text-xs text-readout sm:col-span-3">
          <span className="font-sans text-[10px] uppercase tracking-wide text-ink-faint">At home · </span>
          {s.home.between.length ? `${s.home.between.map((b) => `${Math.round(b.hours)}h`).join(", ")} between departures · ` : ""}
          {s.home.nightsHome} night{s.home.nightsHome === 1 ? "" : "s"} in your own bed
          {s.home.shortGaps > 0 ? (
            <span className="text-warn">{` · ${s.home.shortGaps} short stay${s.home.shortGaps === 1 ? "" : "s"} (under ${s.home.minBreakNights} nights)`}</span>
          ) : (
            ""
          )}
        </p>
      )}
      {s.hubTurns && (
        <p className="col-span-2 font-mono text-xs text-readout sm:col-span-3">
          <span className="font-sans text-[10px] uppercase tracking-wide text-ink-faint">Hub turns · </span>
          {s.hubTurns.all} at {s.hubTurns.hubs.join(", ")}
          {s.hubTurns.night ? ` · ${s.hubTurns.night === s.hubTurns.all ? "all" : s.hubTurns.night} at night` : " · by day"}
          {s.hubTurns.longestRun > 1 ? ` · up to ${s.hubTurns.longestRun} nights in a row` : ""}
          {s.hubTurns.withRestHotel ? ` · ${s.hubTurns.withRestHotel} with a crew-rest hotel` : ""}
        </p>
      )}
      {s.daysOff !== s.printedDaysOff && (
        <p className="col-span-2 text-[11px] leading-snug text-ink-faint sm:col-span-3">
          The bid pack prints {s.printedDaysOff} days off for this line; the calendar draws {s.daysOff} from the trips&rsquo; dates, so a day at either end of a trip can differ.
        </p>
      )}
      <div className="col-span-2 min-w-0 sm:col-span-3">
        <dt className="text-[10px] uppercase tracking-wide text-ink-faint">
          Layovers · {s.layoverNights} night{s.layoverNights === 1 ? "" : "s"}
          {s.internationalLayoverNights > 0 ? ` (${s.internationalLayoverNights} international)` : ""}
        </dt>
        <dd className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs font-medium text-ink">
          {cities.length === 0 && <span className="text-ink-muted">none</span>}
          {cities.map((c) => (
            <span key={c.code} className="inline-flex items-center gap-0.5">
              {c.code}
              {c.nights > 1 && <span className="font-normal text-ink-muted">×{c.nights}</span>}
              <CityMarkGlyph mark={c.sentiment} />
            </span>
          ))}
          {s.cities.length > cities.length && <span className="font-normal text-ink-muted">+{s.cities.length - cities.length} more</span>}
        </dd>
      </div>
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
  /** Just the month (the interview's line cards): no summary or legend under it. */
  compact?: boolean;
}

export const MiniLinePreview = memo(function MiniLinePreview({
  line,
  bidPeriodStart,
  bidPeriodDays,
  showLegend = true,
  cityPreferences,
  departureOptions,
  compact = false,
}: MiniLinePreviewProps) {
  const month: DetailedMonth = useMemo(
    () => buildDetailedMonth(line, bidPeriodStart, bidPeriodDays, cityPreferences, departureOptions),
    [line, bidPeriodStart, bidPeriodDays, cityPreferences, departureOptions]
  );
  const [selected, setSelected] = useState<number | null>(null);
  // The month lays itself out the first time it scrolls into view (see
  // .cal-grid in globals.css) — not before, so a long list doesn't spend its
  // animation on cards nobody has reached yet.
  const [gridRef, gridWidth] = useMeasuredWidth<HTMLDivElement>(560);
  // Starts just before it scrolls on screen, so the build is under way by the time it's seen.
  const revealed = useInView(gridRef, { once: true, margin: "0px 0px 10% 0px" });
  // Seven days and six gaps across the grid, less each day's own padding.
  const barWidth = Math.max(0, (gridWidth - 6 * 4) / 7 - 8);

  if (line.trips.length === 0) return null;
  const selectedDay = selected !== null ? month.days[selected] : null;

  return (
    <div>
      <div role="group" aria-label={`Bid month at a glance. ${month.summary.daysOff} days off, ${month.summary.dutyPeriods} duty periods.`}>
        {month.weekdayHeaders && (
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-faint" aria-hidden>
            {month.weekdayHeaders.map((d) => (
              <span key={d} className={d === "Sat" || d === "Sun" ? "text-ink-muted" : ""}>{d}</span>
            ))}
          </div>
        )}
        <div ref={gridRef} className={`cal-grid grid grid-cols-7 gap-1 ${revealed ? "is-revealed" : ""}`}>
          {month.days.map((day, i) => (
            <Cell
              key={day.dayIndex}
              index={i}
              day={day}
              joinLeft={i % 7 !== 0 && (day.chain !== null || (!day.isTripStart && month.days[i - 1]?.tripIndex === day.tripIndex && month.days[i - 1]?.kind !== "off"))}
              joinRight={i % 7 !== 6 && (month.days[i + 1]?.chain != null || (!day.isTripEnd && month.days[i + 1]?.tripIndex === day.tripIndex && month.days[i + 1]?.kind !== "off"))}
              selected={selected === day.dayIndex}
              barWidth={barWidth}
              onSelect={() => setSelected((cur) => (cur === day.dayIndex ? null : day.dayIndex))}
            />
          ))}
        </div>
      </div>

      {selectedDay ? <DayDetail day={selectedDay} /> : <p className="mt-1.5 text-[11px] text-ink-faint print:hidden">Tap a day for everything on it.</p>}

      {!compact && <Summary s={month.summary} line={line} />}

      {showLegend && !compact && <MonthLegend className="mt-2" />}

      {!month.placementIsReal && (
        <p className="mt-1.5 text-xs text-ink-faint">
          Trip lengths and total days off are exact, but this line&rsquo;s exact dates couldn&rsquo;t be confirmed, so trips are shown in order rather than on verified dates.
        </p>
      )}
    </div>
  );
});
