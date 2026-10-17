"use client";

import { useInView } from "motion/react";
import { memo, useMemo, useRef, useState } from "react";
import { BedIcon, MoonIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { buildDetailedMonth, type DetailedDay, type DetailedMonth, type MonthSummary, type RouteStop, type TripFinish } from "@/lib/month-detail";
import { dayStats, equipmentLabel, hm } from "@/lib/trip-day-stats";
import type { TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { CityMark } from "@/types/preferences";

/**
 * The whole bid month for one line, as much of it as a card can carry: each
 * day shows its trip's own number, when the duty starts (and when the trip
 * ends), a 24-hour strip of what the day is made of, its landings, red-eyes
 * and early reports, and the layover city — marked with how the pilot feels
 * about it. Tapping a day opens everything the bid pack says about it below
 * the grid; a strip under it sums the month up in the terms the interview
 * asks about (days off and how they fall, standby, report times, cities…).
 * The hour-by-hour chart per trip still lives in the expanded card.
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

/** "17.8" credit hours → "17:47", the way the bid pack prints a trip's credit under its number. */
const creditClock = (h: number) => hm(Math.round(h * 60));

/**
 * The day's flying the way the bid pack prints it: the cities, in order, flown hops joined by a dash and deadheads by
 * "dh" ("MEM dh PHX dh SEA", "IND–DFW–IND"). Each hop stays whole when the line wraps.
 */
function Route({ stops }: { stops: RouteStop[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline font-mono text-[10px] leading-tight">
      {stops.map((s, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 && (s.viaDeadhead ? <span className="mx-[3px] text-[9px] italic text-ink-faint">dh</span> : <span className="text-ink-faint">–</span>)}
          <span className={s.viaDeadhead ? "text-ink-muted" : "font-semibold text-ink"}>{s.city}</span>
        </span>
      ))}
    </span>
  );
}

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
 * One day of the month, laid out like a day column of the bid pack's own line: the trip's number and credit on its
 * first day, the day's cities, where the night is spent, and where the trip lands on its last day. Times stay out of
 * the way — the report on the first day and the landing on the last; tap the day for every flight and time.
 */
function Cell({
  day,
  selected,
  onSelect,
  index,
  joinLeft,
  joinRight,
}: {
  day: DetailedDay;
  selected: boolean;
  onSelect: () => void;
  index: number;
  joinLeft: boolean;
  joinRight: boolean;
}) {
  const isOff = day.kind === "off";
  const standby = day.flights.find((f) => f.kind === "standby");
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
      {/* A red-eye day is genuinely darker, not just icon-flagged — a faint tonal wash rather than a new hue, so it stays inside the warm palette. */}
      {!isOff && day.redEye && <span aria-hidden className="absolute inset-0 -z-10 rounded-md bg-ink/10" />}
      {!isOff && day.tripIndex !== null && day.kind !== "estimated" && <TripRail joinLeft={joinLeft} joinRight={joinRight} standby={day.kind === "standby"} />}
      <span className="flex items-start justify-between gap-0.5">
        <span className={`inline-flex items-center gap-0.5 text-[11px] tabular-nums ${isOff ? "" : "font-semibold"}`}>
          {day.label}
          {!isOff && day.redEye && <MoonIcon className="h-2.5 w-2.5 shrink-0 text-accent" aria-label="red-eye" />}
        </span>
        {day.isTripStart && day.tripNumber && (
          <span className="hidden whitespace-nowrap rounded bg-calendar-accent px-0.5 font-mono text-[10px] font-semibold text-on-calendar @min-[4.75rem]:inline">
            #{day.tripNumber}
            {day.tripCreditHours !== null && <span className="hidden font-normal opacity-80 @min-[5rem]:inline"> {creditClock(day.tripCreditHours)}</span>}
          </span>
        )}
      </span>

      {isOff ? (
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
      ) : (
        <>
          {/* On a phone the cell is too narrow for the trip number beside the date, so it sits on its own line. */}
          {day.isTripStart && day.tripNumber && <span className="font-mono text-[10px] font-semibold leading-tight text-ink @min-[4.75rem]:hidden">#{day.tripNumber}</span>}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
            {day.chain ? (
              <span className="hidden whitespace-nowrap font-mono text-[10px] leading-tight text-calendar-accent @min-[4.75rem]:block" title={`Turns straight out of trip #${day.chain.fromTripNumber ?? ""}: lands ${day.chain.landed}, reports ${day.chain.reports} (L) — one departure from home`}>
                ↪ {turnLabel(day.chain.turnMinutes)} in {day.chain.city}
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
            {day.route.length > 0 && (
              <span className="hidden @min-[4.75rem]:block">
                <Route stops={day.route} />
              </span>
            )}
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
            <li><span className="font-medium text-ink">Trips joined into one bar.</span> A trip that reports within hours of the last one landing at base (<span className="font-mono">↪ 1h47 in MEM</span>) &mdash; flown back to back without going home, so the run counts as one departure.</li>
            <li><span className="font-medium text-ink">The cities.</span> Each day&rsquo;s flying, city to city: a dash is flown (<span className="font-mono">MEM–SEA</span>), <span className="font-mono">dh</span> a deadhead (<span className="font-mono">MEM dh PHX</span>).</li>
            <li><span className="font-medium text-ink">Green city.</span> Where you sleep and how long the layover is (<span className="font-mono">SEA 15h</span>). <span className="font-mono">KIX rest</span> is a whole day at the hotel with nothing flown. <span className="text-good">♥</span> is a city you love, <span className="text-good">♡</span> one you like, an amber <span className="text-warn">✕</span> one you dislike and a red <span className="text-danger">✕</span> one you avoid, and a dotted underline marks an international city.</li>
            <li><span className="font-medium text-ink">↘ MEM 19:05.</span> Where and when the trip lands, on its last day. <span className="font-mono">+1</span> means just after midnight &mdash; the bid pack still counts the next day as off.</li>
            <li><span className="font-medium text-ink">Violet day.</span> Hotel standby (<span className="font-mono">SBY</span>) &mdash; on call at the hotel, paid, not flying.</li>
            <li><span className="font-medium text-ink">Dashed empty day.</span> A day off; a run of them is labeled on its first day (&ldquo;4 days off&rdquo;).</li>
            <li><span className="font-medium text-ink">Moon and a darker day.</span> A flight departs or lands between midnight and 5am.</li>
            <li><span className="font-medium text-ink">Tap any day</span> for every flight with its times and aircraft, the hotel and rest, block time and landings. Every time is local (L). The hour-by-hour chart for each trip is under &ldquo;Details&rdquo;.</li>
          </ul>
        </Modal>
      )}
    </>
  );
}

/** The key to every month grid on the page — shown once above a list of them rather than under each one, and under each one only where a grid stands alone (the comparison view). */
export function MonthLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted ${className}`}>
      <span className="inline-flex items-center gap-1"><span className="rounded bg-calendar-accent px-0.5 font-mono text-[10px] font-semibold text-on-calendar">#111 17:47</span>Trip and its credit</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px]"><span className="font-semibold">MEM</span><span className="text-ink-faint">–</span><span className="font-semibold">SEA</span></span>Flown</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px]"><span className="font-semibold">MEM</span><span className="px-px text-[9px] text-ink-faint">dh</span><span className="text-ink-muted">PHX</span></span>Deadhead</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px] text-calendar-accent">↪ 1h47 in MEM</span>Turns into the next trip</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px] font-semibold text-good">SEA 15h</span>Where you sleep</span>
      <span className="inline-flex items-center gap-1"><span className="text-good">♥</span>love <span className="text-good">♡</span>like <span className="text-warn">✕</span>dislike</span>
      <span className="inline-flex items-center gap-1"><span className="font-mono text-[11px]"><span className="text-ink-faint">↘</span><span className="font-semibold">MEM</span> 00:56<span className="text-[9px] text-ink-muted">+1</span></span>Lands</span>
      <LegendItem swatch="bg-standby/25 border-t-2 border-standby" label="Hotel standby" />
      <LegendItem swatch="border border-dashed border-border-strong" label="Day off" />
      <span className="inline-flex items-center gap-1"><MoonIcon className="h-3 w-3 text-accent" />Red-eye</span>
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
          {day.spill && <SpillList spill={day.spill} offDay />}
        </>
      ) : day.preReportTime !== null ? (
        <p className="mt-1">
          Not a day off: {day.tripNumber ? `trip #${day.tripNumber}` : "the next trip"} reports
          {day.preReportTime ? ` at ${day.preReportTime} (L)` : ""} the next morning, so the bid pack gives this evening to it.
        </p>
      ) : (
        <>
          {day.chain && (
            <p className="mt-1 text-ink">
              Turns straight out of trip #{day.chain.fromTripNumber}: lands {day.chain.city} {day.chain.landed}, reports again {day.chain.reports} (L) &mdash;{" "}
              {turnLabel(day.chain.turnMinutes)} on the ground, so the two are flown as one departure from home.
            </p>
          )}
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
      <dd className={`truncate font-mono text-xs font-medium ${tone || "text-readout"}`}>{value}</dd>
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
}

export const MiniLinePreview = memo(function MiniLinePreview({
  line,
  bidPeriodStart,
  bidPeriodDays,
  showLegend = true,
  cityPreferences,
}: MiniLinePreviewProps) {
  const month: DetailedMonth = useMemo(
    () => buildDetailedMonth(line, bidPeriodStart, bidPeriodDays, cityPreferences),
    [line, bidPeriodStart, bidPeriodDays, cityPreferences]
  );
  const [selected, setSelected] = useState<number | null>(null);
  // The month lays itself out the first time it scrolls into view (see
  // .cal-grid in globals.css) — not before, so a long list doesn't spend its
  // animation on cards nobody has reached yet.
  const gridRef = useRef<HTMLDivElement>(null);
  // Starts just before it scrolls on screen, so the build is under way by the time it's seen.
  const revealed = useInView(gridRef, { once: true, margin: "0px 0px 10% 0px" });

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
              onSelect={() => setSelected((cur) => (cur === day.dayIndex ? null : day.dayIndex))}
            />
          ))}
        </div>
      </div>

      {selectedDay ? <DayDetail day={selectedDay} /> : <p className="mt-1.5 text-[11px] text-ink-faint print:hidden">Tap a day for everything on it.</p>}

      <Summary s={month.summary} line={line} />

      {showLegend && <MonthLegend className="mt-2" />}

      {!month.placementIsReal && (
        <p className="mt-1.5 text-xs text-ink-faint">
          Trip lengths and total days off are exact, but this line&rsquo;s exact dates couldn&rsquo;t be confirmed, so trips are shown in order rather than on verified dates.
        </p>
      )}
    </div>
  );
});
