"use client";

import { memo, useMemo, useState } from "react";
import { MoonIcon, PlaneIcon, SunriseIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { buildDetailedMonth, type DetailedDay, type DetailedMonth, type MonthSummary, type StripSegment } from "@/lib/month-detail";
import type { TimelineSegmentKind } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";
import type { CitySentiment } from "@/types/preferences";

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

const STRIP_CLASS: Record<TimelineSegmentKind, string> = {
  flying: "bg-calendar-accent",
  deadhead: "bg-calendar-accent/45 [background-image:repeating-linear-gradient(135deg,transparent,transparent_2px,rgba(255,255,255,0.4)_2px,rgba(255,255,255,0.4)_4px)]",
  standby: "bg-standby",
  layover: "bg-good",
  ground: "bg-accent",
  connection: "bg-border-strong",
};

function Strip({ segments }: { segments: StripSegment[] }) {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-border/60" aria-hidden>
      {segments.map((s, i) => (
        <span
          key={i}
          className={`absolute inset-y-0 ${STRIP_CLASS[s.kind]}`}
          style={{ left: `${(s.start / 1440) * 100}%`, width: `${Math.max(2, ((s.end - s.start) / 1440) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function cellClass(day: DetailedDay, selected: boolean): string {
  const base =
    "relative flex min-h-[3.25rem] flex-col justify-between gap-0.5 rounded-md p-1 text-left leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:min-h-[4.5rem]";
  const ring = selected
    ? " ring-2 ring-ink"
    : day.isTripStart
      ? " ring-2 ring-calendar-accent ring-offset-1 ring-offset-surface"
      : "";
  switch (day.kind) {
    case "off":
      return `${base} border border-dashed ${day.isWeekend ? "border-border-strong bg-canvas" : "border-border"} text-ink-faint hover:border-ink-faint${ring}`;
    case "standby":
      return `${base} bg-standby/25 text-ink hover:bg-standby/35${ring}`;
    case "layover":
      return `${base} bg-good/25 text-ink hover:bg-good/35${ring}`;
    case "estimated":
      return `${base} bg-brand-soft text-brand${ring}`;
    default:
      return `${base} bg-calendar-accent/20 text-ink hover:bg-calendar-accent/30${ring}`;
  }
}

function SentimentMark({ sentiment }: { sentiment: CitySentiment | null }) {
  if (sentiment === "love") return <span className="text-good" aria-label="a city you love">♥</span>;
  if (sentiment === "avoid") return <span className="text-danger" aria-label="a city you avoid">✕</span>;
  return null;
}

function Cell({ day, selected, onSelect }: { day: DetailedDay; selected: boolean; onSelect: () => void }) {
  const isOff = day.kind === "off";
  return (
    <button type="button" onClick={onSelect} title={day.title} aria-label={day.title} aria-pressed={selected} className={cellClass(day, selected)}>
      <span className="flex items-start justify-between gap-0.5">
        <span className={`text-[11px] tabular-nums ${isOff ? "" : "font-semibold"}`}>{day.label}</span>
        {day.isTripStart && day.tripNumber && (
          <span className="hidden rounded bg-ink/80 px-0.5 font-mono text-[10px] font-semibold text-canvas sm:inline">#{day.tripNumber}</span>
        )}
      </span>

      {isOff ? (
        <span className="text-[10px] font-medium leading-tight">
          {day.offRun && day.offRun.length > 1 && day.offRun.isFirst ? `${day.offRun.length} off` : ""}
        </span>
      ) : (
        <>
          {/* On a phone the cell is too narrow for the trip number beside the date, so it sits on its own line where the times go on wider screens. */}
          {day.isTripStart && day.tripNumber && (
            <span className="font-mono text-[10px] font-semibold leading-tight text-ink sm:hidden">#{day.tripNumber}</span>
          )}
          <span className="hidden whitespace-nowrap font-mono text-[10px] leading-tight text-ink-muted sm:block">
            {day.releaseTime ? `→${day.releaseTime}` : day.dutyStart ? `R${day.dutyStart}` : " "}
          </span>
          <span className="flex items-center gap-0.5 text-[11px] font-semibold tracking-tight">
            {day.layoverCode ? (
              <>
                <span className={day.layoverInternational ? "underline decoration-dotted underline-offset-2" : ""}>{day.layoverCode}</span>
                <SentimentMark sentiment={day.citySentiment} />
              </>
            ) : day.hasStandby ? (
              <span className="text-[10px] font-medium text-standby">standby</span>
            ) : (
              <span className="text-[10px] font-normal text-ink-muted">{day.hasDeadhead && day.landings === 0 ? "DH" : " "}</span>
            )}
          </span>
          <span className="hidden items-center gap-1 text-[10px] leading-none text-ink-muted sm:flex">
            {day.landings > 0 && (
              <span className="inline-flex items-center gap-px" title={`${day.landings} landing${day.landings === 1 ? "" : "s"}`}>
                <PlaneIcon className="h-2.5 w-2.5" />
                {day.landings}
              </span>
            )}
            {day.hasStandby && <span className="font-semibold uppercase tracking-tight text-standby">sby</span>}
            {day.redEye && <MoonIcon className="h-2.5 w-2.5 text-accent" />}
            {day.earlyReport && <SunriseIcon className="h-2.5 w-2.5 text-warn" />}
          </span>
          <Strip segments={day.strip} />
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
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink">
        What do these mean?
      </button>
      {open && (
        <Modal title="Month calendar key" onClose={() => setOpen(false)}>
          <ul className="space-y-3 text-sm leading-relaxed text-ink-muted">
            <li><span className="font-medium text-ink">Blue day.</span> You&rsquo;re on a trip. The tag on its first day (<span className="font-mono">#60</span>) is the trip&rsquo;s number in your bid pack, and a ringed day is that first day.</li>
            <li><span className="font-medium text-ink">Green day with a code.</span> The night you check into a layover hotel, and the city. A <span className="text-good">♥</span> is a city you love, a <span className="text-danger">✕</span> one you avoid, and a dotted underline marks an international city.</li>
            <li><span className="font-medium text-ink">Purple day.</span> Hotel standby &mdash; on call at the hotel, paid, not flying.</li>
            <li><span className="font-medium text-ink">Dashed empty day.</span> A day off. A run of days off is labeled on its first day (&ldquo;4 off&rdquo;), and weekends are shaded.</li>
            <li><span className="font-medium text-ink">R05:20 / →18:04.</span> When the duty starts that day, and (with the arrow) when your last flight lands on the day the trip ends.</li>
            <li><span className="font-medium text-ink">Plane and number.</span> Landings that day. <span className="font-medium text-ink">Moon:</span> a flight departs or lands between midnight and 5am. <span className="font-medium text-ink">Sun:</span> the duty starts between 2 and 6am, when your body clock is at its lowest.</li>
            <li><span className="font-medium text-ink">Thin bar along the bottom.</span> The day&rsquo;s 24 hours &mdash; blue is flying, hatched is deadhead, purple is standby, green is layover, gold is report and ground time.</li>
            <li><span className="font-medium text-ink">Tap any day</span> for every flight, time, layover hotel and rest on it. The hour-by-hour chart for each trip is in the expanded card.</li>
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
      <LegendItem swatch="bg-calendar-accent/40" label="Trip day" />
      <LegendItem swatch="bg-good/40" label="Layover night" />
      <LegendItem swatch="bg-standby/40" label="Hotel standby" />
      <LegendItem swatch="border border-dashed border-border-strong" label="Day off" />
      <span className="inline-flex items-center gap-1"><MoonIcon className="h-3 w-3 text-accent" />Red-eye</span>
      <span className="inline-flex items-center gap-1"><SunriseIcon className="h-3 w-3 text-warn" />Early report</span>
      <MonthKeyInfo />
    </div>
  );
}

function DayDetail({ day }: { day: DetailedDay }) {
  return (
    <div className="mt-2 rounded-lg border border-border bg-canvas p-3 text-xs leading-relaxed text-ink-muted" aria-live="polite">
      <div className="font-medium text-ink">{day.title.split(" — ")[0]}</div>
      {day.kind === "off" ? (
        <p className="mt-1">
          A day off
          {day.offRun && day.offRun.length > 1 ? ` — day ${day.offRun.position} of ${day.offRun.length} in a row.` : " — a single day, on either side of a trip."}
        </p>
      ) : (
        <>
          <p className="mt-1">
            {day.tripNumber ? `Trip #${day.tripNumber}` : "Trip"}, day {day.tripDay} of {day.tripDayCount}
            {day.tripCreditHours !== null ? ` · ${day.tripCreditHours.toFixed(1)} credit hours for the trip` : ""}.
          </p>
          {day.kind === "estimated" ? (
            <p className="mt-1">Exact daily detail isn&rsquo;t available for this line.</p>
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
                    </span>
                  </li>
                ))}
            </ul>
          )}
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
      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className={`truncate text-xs font-medium ${tone || "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Summary({ s }: { s: MonthSummary }) {
  const cities = s.cities.slice(0, 5);
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-border bg-canvas px-3 py-2 sm:grid-cols-3">
      <SummaryItem label="Days off in a row" value={`${fmtRuns(s.offRuns)}`} />
      <SummaryItem label="Weekends off" value={s.weekendsTotal > 0 ? `${s.weekendsOff} of ${s.weekendsTotal}` : "—"} />
      <SummaryItem label="Duty periods" value={String(s.dutyPeriods)} />
      <SummaryItem label="Earliest duty start" value={s.earliestDutyStart ?? "—"} tone={s.earlyReportDays > 0 ? "text-warn" : ""} />
      <SummaryItem label="Latest landing" value={s.latestRelease ?? "—"} />
      <SummaryItem label="Landings" value={String(s.landings)} />
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
              <SentimentMark sentiment={c.sentiment} />
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
  cityPreferences?: Record<string, CitySentiment>;
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
        <div className="grid grid-cols-7 gap-1">
          {month.days.map((day) => (
            <Cell key={day.dayIndex} day={day} selected={selected === day.dayIndex} onSelect={() => setSelected((cur) => (cur === day.dayIndex ? null : day.dayIndex))} />
          ))}
        </div>
      </div>

      {selectedDay ? <DayDetail day={selectedDay} /> : <p className="mt-1.5 text-[11px] text-ink-faint">Tap a day for everything on it.</p>}

      <Summary s={month.summary} />

      {showLegend && <MonthLegend className="mt-2" />}

      {!month.placementIsReal && (
        <p className="mt-1.5 text-xs text-ink-faint">
          Trip lengths and total days off are exact, but this line&rsquo;s exact dates couldn&rsquo;t be confirmed, so trips are shown in order rather than on verified dates.
        </p>
      )}
    </div>
  );
});
