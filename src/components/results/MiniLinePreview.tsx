"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { Modal } from "@/components/ui/Modal";
import { TimeModeToggle } from "@/components/results/TimeModeToggle";
import { buildLineMonthCalendar, type LineMonthDay } from "@/lib/line-month";
import { loadTimeMode, saveTimeMode } from "@/lib/time-mode-storage";
import type { TimeMode, TimelineSegment } from "@/lib/trip-timeline";
import type { Line } from "@/types/bidpack";

/**
 * The whole bid month for this line, as one compact real calendar — day
 * columns spanning the full bid period, days off shown as clearly empty
 * columns between trips, each trip's own duty/layover shape drawn with the
 * same segment language (and colors) as the full local-time calendar
 * (`TripList.tsx`), just condensed to fit inside a results card. Deliberately
 * a smaller version of that same calendar, not a different kind of
 * component: a pilot who already reads one should recognize the other
 * immediately.
 *
 * Day-column *structure* (which real calendar day each column is) always
 * follows local-calendar day-splitting regardless of the Local/Zulu toggle —
 * see `buildLineMonthCalendar`'s own doc comment for why — so the whole
 * month's shape stays put when the toggle is pressed; the toggle still
 * switches which clock is primary in every segment's own tooltip, same as
 * the full calendar.
 */

const COLUMN_WIDTH_PX = 34;
const BAR_HEIGHT_PX = 64;
const MINUTES_PER_DAY = 24 * 60;

function segmentClass(kind: TimelineSegment["kind"]): string {
  if (kind === "layover") return "bg-good";
  if (kind === "ground") return "bg-accent";
  if (kind === "connection") return "bg-border-strong";
  if (kind === "deadhead") {
    return "bg-brand/40 [background-image:repeating-linear-gradient(135deg,transparent,transparent_3px,rgba(255,255,255,0.35)_3px,rgba(255,255,255,0.35)_6px)]";
  }
  return "bg-brand";
}

const LAYOVER_TOOLTIP =
  "Layover — a real hotel stop between duty periods, from block-in to the next pickup for departure.";
const GROUND_TOOLTIP = "On the ground before departure — report/check-in, or hotel-to-airport transport after a layover.";
const CONNECTION_TOOLTIP = "Short ground time between two flights in the same duty period — not a layover.";

const SEGMENT_TOOLTIP_SUFFIX: Partial<Record<TimelineSegment["kind"], string>> = {
  layover: LAYOVER_TOOLTIP,
  ground: GROUND_TOOLTIP,
  connection: CONNECTION_TOOLTIP,
};

function LegendSwatch({ className, label, title }: { className: string; label: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`h-2 w-3 shrink-0 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

/** A short, spelled-out badge rather than a bare "+1d"/"-1d" symbol — a pilot glancing at this column should be able to tell what it means without already knowing the convention; the full explanation is still one hover/tap away. */
function DateLineBadge({ badge }: { badge: TimelineSegment["dateLineBadge"] }) {
  if (!badge) return null;
  const label = badge.delta > 0 ? "+1 day" : "−1 day";
  return (
    <span
      title={badge.explanation}
      className="absolute -right-1.5 -top-1.5 z-10 whitespace-nowrap rounded-full border border-warn/40 bg-warn-soft px-1 py-0.5 font-mono text-[7px] font-semibold leading-none text-warn"
    >
      {label}
    </span>
  );
}

/** One occupied day's mini vertical bar — same segment colors/positions as the full calendar's own day column, condensed. */
function DayBar({ day }: { day: LineMonthDay }) {
  if (!day.hasSchedule) {
    return (
      <div
        className="relative rounded-sm bg-brand-soft"
        style={{ height: BAR_HEIGHT_PX }}
        title="Part of this trip — exact daily detail isn't available (this line's calendar entries couldn't be confidently matched to a specific pairing)."
      >
        <div className="flex h-full items-center justify-center px-0.5 text-center font-mono text-[7px] font-medium leading-tight text-brand">
          on trip
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-visible rounded-sm bg-canvas" style={{ height: BAR_HEIGHT_PX }}>
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
            height: `${Math.max(2, ((seg.endMinuteOfDay - seg.startMinuteOfDay) / MINUTES_PER_DAY) * 100)}%`,
          }}
        >
          <DateLineBadge badge={seg.dateLineBadge} />
        </div>
      ))}
    </div>
  );
}

/** A day-off column — deliberately the visual opposite of a trip day (dashed border, muted, no fill) so an empty day reads as unmistakably empty at a glance, not just "nothing drawn yet." */
function OffDayBar() {
  return (
    <div
      className="rounded-sm border border-dashed border-border bg-transparent"
      style={{ height: BAR_HEIGHT_PX }}
      title="Day off — no duty scheduled."
    />
  );
}

function DayHeader({ day }: { day: LineMonthDay }) {
  if (day.date && day.weekday) {
    return (
      <div className="text-center leading-tight">
        <div className="font-mono text-[8px] font-medium text-ink-faint">{day.weekday}</div>
        <div className="font-mono text-[9px] font-semibold text-brand">{Number(day.date.slice(8, 10))}</div>
      </div>
    );
  }
  return (
    <div className="text-center font-mono text-[8px] font-medium text-brand" title="Exact calendar date not confirmed for this line — see the note below the calendar.">
      D{day.dayIndex + 1}
    </div>
  );
}

interface DayGroup {
  tripIndex: number | null;
  days: LineMonthDay[];
}

function groupDays(days: LineMonthDay[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const day of days) {
    const last = groups.at(-1);
    if (last && last.tripIndex === day.tripIndex) {
      last.days.push(day);
    } else {
      groups.push({ tripIndex: day.tripIndex, days: [day] });
    }
  }
  return groups;
}

function TripGroupCaption({ line, tripIndex, dayCount }: { line: Line; tripIndex: number; dayCount: number }) {
  const trip = line.trips[tripIndex];
  const cities = trip.layoverCities.length > 0 ? trip.layoverCities.join(" → ") : "no layovers";
  return (
    <div
      className="mb-0.5 truncate text-[9px] font-medium text-brand"
      title={`Trip ${tripIndex + 1} of ${line.trips.length} — ${dayCount}-day — ${cities}`}
    >
      Trip {tripIndex + 1} · {dayCount}-day · {cities}
    </div>
  );
}

function OffGroupCaption({ dayCount }: { dayCount: number }) {
  return (
    <div className="mb-0.5 truncate text-center text-[9px] font-medium text-ink-faint">
      {dayCount} day{dayCount === 1 ? "" : "s"} off
    </div>
  );
}

function MonthLegendInfo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center text-[10px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        What do these mean?
      </button>
      {open && (
        <Modal title="Month calendar key" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
            <div>
              <div className="font-medium text-ink">Calendar blocks</div>
              <ul className="mt-1.5 space-y-2">
                <li>
                  <span className="font-medium text-ink">Flying.</span> Actual block time,
                  wheels up to wheels down.
                </li>
                <li>
                  <span className="font-medium text-ink">Deadhead.</span> Riding along, not
                  operating.
                </li>
                <li>
                  <span className="font-medium text-ink">Layover.</span> {LAYOVER_TOOLTIP}
                </li>
                <li>
                  <span className="font-medium text-ink">Ground.</span> {GROUND_TOOLTIP}
                </li>
                <li>
                  <span className="font-medium text-ink">Connection.</span> {CONNECTION_TOOLTIP}
                </li>
                <li>
                  <span className="font-medium text-ink">Day off.</span> An empty, dashed
                  column — no duty scheduled that day.
                </li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">Other marks</div>
              <ul className="mt-1.5 space-y-2">
                <li>
                  <span className="font-medium text-ink">+1 day / −1 day badge.</span>{" "}
                  This leg&rsquo;s local landing date is a day later (or earlier) than its
                  real flight time alone would suggest, purely because of crossing into a
                  different timezone — the same thing a &ldquo;*&rdquo; or &ldquo;#&rdquo;
                  mark flags on a printed pairing schedule. Hover or tap the badge for the
                  specific times.
                </li>
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

interface MiniLinePreviewProps {
  line: Line;
  /** Real UTC offset derived from the bid pack's own printed times — see lib/circadian.ts. Currently unused here; kept for API parity with the full calendar's own props. */
  homeBaseOffsetMinutes: number | null;
  bidPeriodStart: string | null;
  bidPeriodDays: number;
}

export const MiniLinePreview = memo(function MiniLinePreview({
  line,
  bidPeriodStart,
  bidPeriodDays,
}: MiniLinePreviewProps) {
  // Same lazy-init-then-sync pattern as TripList's own toggle, so this
  // never renders "zulu" on the server and "local" on the client (or vice
  // versa) before hydration catches up.
  const [mode, setMode] = useState<TimeMode>("local");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(loadTimeMode());
  }, []);

  function handleModeChange(next: TimeMode) {
    setMode(next);
    saveTimeMode(next);
  }

  const calendar = useMemo(
    () => buildLineMonthCalendar(line, bidPeriodStart, bidPeriodDays, mode),
    [line, bidPeriodStart, bidPeriodDays, mode]
  );

  if (line.trips.length === 0) return null;

  const groups = groupDays(calendar.days);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <TimeModeToggle mode={mode} onChange={handleModeChange} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-medium text-brand">
            <LegendSwatch className="bg-brand" label="Flying" />
            <LegendSwatch className={segmentClass("deadhead")} label="Deadhead" title="Riding along, not operating" />
            <LegendSwatch className="bg-good" label="Layover" title={LAYOVER_TOOLTIP} />
            <LegendSwatch className="bg-accent" label="Ground" title={GROUND_TOOLTIP} />
            <LegendSwatch className="border border-dashed border-border-strong bg-transparent" label="Day off" />
          </div>
          <MonthLegendInfo />
          <CircadianInfo />
        </div>
      </div>

      <div className="mt-2 overflow-x-auto pb-1">
        <div className="flex gap-2">
          {groups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.tripIndex !== null ? (
                <TripGroupCaption line={line} tripIndex={group.tripIndex} dayCount={group.days.length} />
              ) : (
                <OffGroupCaption dayCount={group.days.length} />
              )}
              <div
                className={`flex gap-px rounded-md p-1 ${
                  group.tripIndex !== null ? "border border-brand/25 bg-brand-soft/40" : ""
                }`}
              >
                {group.days.map((day) => (
                  <div key={day.dayIndex} style={{ width: COLUMN_WIDTH_PX }}>
                    <DayHeader day={day} />
                    <div className="mt-0.5">{day.isOff ? <OffDayBar /> : <DayBar day={day} />}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!calendar.placementIsReal && (
        <p className="mt-1.5 text-[10px] text-ink-faint">
          Trip lengths and total days off are exact; exact calendar dates for this line
          couldn&rsquo;t be confirmed, so trips are shown in order with days off spaced
          between them rather than on verified dates.
        </p>
      )}
    </div>
  );
});
