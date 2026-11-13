"use client";

import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { baseDayStartMinutes, dayIndices, zoneOf, type Span } from "@/lib/phase-in";
import { tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import type { LineSlides, SlideOption } from "@/lib/vacation-slide";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * One top line's bid month drawn as a strip, with the pilot's vacation as a gold footprint over the days.
 * Slide the footprint (or tap a suggestion) and the trips it takes off, the hours it draws from the bank, the
 * days off and the score all move with it — our scored, contract-checked slides shown the way a pilot reads a calendar.
 * It never submits anything; the slide is entered in VIPS during the Conflict Input Window (CBA 2026 25.E.2.b).
 */

const HOUR = 3_600_000;
const COL = 26;
const WEEKDAY = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "As awarded", or how this option moves the vacation. */
function moveWords(o: Pick<SlideOption, "offset" | "expandBefore" | "expandAfter">): string {
  const parts: string[] = [];
  if (o.offset) parts.push(`${plural(Math.abs(o.offset), "day")} ${o.offset < 0 ? "earlier" : "later"}`);
  if (o.expandBefore) parts.push(`+${plural(o.expandBefore, "day")} before`);
  if (o.expandAfter) parts.push(`+${plural(o.expandAfter, "day")} after`);
  return parts.length ? parts.join(", ") : "As awarded";
}

/** The day columns a real-instant span touches inside the bid month. */
function spanDays(span: Span, pack: BidPack): number[] {
  return dayIndices(span, pack);
}

function tripSpanOf(trip: Trip, pack: BidPack): Span | null {
  const report = tripReportUtc(pack, trip);
  return report === null ? null : { start: report, end: report + tripReleaseHours(trip) * HOUR };
}

/** First column and width of a contiguous run of day indices, as a CSS grid-column value. */
function gridColumn(days: number[]): string | null {
  if (!days.length) return null;
  const first = Math.min(...days);
  const last = Math.max(...days);
  return `${first + 1} / ${last + 2}`;
}

export function VacationCalendar({ row, pack, value, byModel }: { row: LineSlides; pack: BidPack; value: number; byModel: boolean }) {
  const zone = zoneOf(pack);
  const dayCount = pack.bidPeriodDays;

  // Every day of the bid month, labelled on the base's calendar.
  const months = useMemo(() => {
    if (!pack.bidPeriodStart) return [];
    const first = DateTime.fromISO(pack.bidPeriodStart, { zone }).plus({ minutes: baseDayStartMinutes(zone) });
    return Array.from({ length: dayCount }, (_, d) => {
      const at = first.plus({ days: d });
      return { d, weekday: WEEKDAY[(at.weekday - 1) % 7], num: at.day, weekend: at.weekday >= 6 };
    });
  }, [pack.bidPeriodStart, zone, dayCount]);

  // This line's trips, where each one sits in the month.
  const trips = useMemo(
    () =>
      row.line.trips.flatMap((trip) => {
        const span = tripSpanOf(trip, pack);
        if (!span) return [];
        const days = spanDays(span, pack);
        return days.length ? [{ trip, days }] : [];
      }),
    [row.line.trips, pack],
  );

  // The pure slides this line offers (no expansion), earliest to latest: the footprint can be dragged across these.
  const slides = useMemo(() => row.all.filter((o) => !o.expandBefore && !o.expandAfter).sort((a, b) => a.offset - b.offset), [row.all]);
  const asAwardedIdx = Math.max(0, slides.findIndex((o) => o.offset === 0));
  const [idx, setIdx] = useState(asAwardedIdx);
  // A chosen suggestion may be an expansion, which the slider can't express; hold it apart from the slider.
  const [picked, setPicked] = useState<SlideOption | null>(null);
  const selected = picked ?? slides[idx] ?? row.asAwarded;

  const vacationDays = useMemo(() => new Set(spanDays(selected.span, pack)), [selected, pack]);
  const removedDays = useMemo(() => {
    const out = new Set<number>();
    for (const r of selected.removed) {
      const span = tripSpanOf(r.trip, pack);
      if (span) for (const d of spanDays(span, pack)) out.add(d);
    }
    return out;
  }, [selected, pack]);
  const removedPairings = useMemo(() => new Set(selected.removed.map((r) => r.trip.pairingNumber)), [selected]);

  const vacCol = gridColumn([...vacationDays]);
  const chips = [row.asAwarded, ...row.best];

  const pickSlider = (i: number) => {
    setIdx(i);
    setPicked(null);
  };
  const pickChip = (o: SlideOption) => {
    const i = slides.findIndex((s) => s.offset === o.offset);
    if (!o.expandBefore && !o.expandAfter && i >= 0) {
      setIdx(i);
      setPicked(null);
    } else {
      setPicked(o);
    }
  };

  if (!months.length) return null;

  return (
    <div className="panel-glass rounded-lg p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink">
          #{row.rank} Line {row.line.lineNumber}
        </p>
        <p className="text-xs text-ink-muted">
          {moveWords(selected)} ·{" "}
          {selected.removed.length ? `takes ${selected.removed.map((r) => `trip ${r.trip.pairingNumber}`).join(", ")} off` : "takes no trips off"} ·{" "}
          {selected.chargedCH.toFixed(1)} CH from bank · {plural(selected.daysOff, "day")} off{selected.longestOff ? `, ${selected.longestOff} in a row` : ""}
          {byModel && selected.score !== null ? ` · scores ${selected.score.toFixed(1)}` : ""}
        </p>
      </div>

      {/* The month, with the vacation footprint over it. */}
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="grid items-end gap-px" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(${COL}px, 1fr))`, gridTemplateRows: "10px auto auto 34px", minWidth: dayCount * COL }}>
          {/* Vacation band */}
          {vacCol && (
            <div className="flex items-center justify-center self-stretch rounded-full bg-accent" style={{ gridColumn: vacCol, gridRow: 1 }} title="Your vacation">
              <span className="truncate px-1 text-[9px] font-semibold uppercase tracking-wide text-surface-raised">Vacation</span>
            </div>
          )}
          {/* Weekday + day number */}
          {months.map((m) => (
            <div key={`h${m.d}`} className="flex flex-col items-center" style={{ gridColumn: m.d + 1, gridRow: "2 / 4" }}>
              <span className="text-[9px] text-ink-faint">{m.weekday}</span>
              <span className={`text-[10px] ${m.weekend ? "text-ink" : "text-ink-muted"}`}>{m.num}</span>
            </div>
          ))}
          {/* Empty day cells, so days off read as a row */}
          {months.map((m) => (
            <div key={`c${m.d}`} className={`self-stretch rounded-sm border ${vacationDays.has(m.d) ? "border-accent/40 bg-accent/10" : "border-hairline/60"}`} style={{ gridColumn: m.d + 1, gridRow: 4 }} />
          ))}
          {/* Trips */}
          {trips.map(({ trip, days }) => {
            const col = gridColumn(days);
            if (!col) return null;
            const off = removedPairings.has(trip.pairingNumber) && days.some((d) => removedDays.has(d));
            return (
              <div
                key={trip.id}
                className={`z-10 flex items-center justify-center self-stretch overflow-hidden rounded-sm border px-1 text-[10px] font-medium ${off ? "border-accent bg-accent/15 text-accent line-through decoration-accent/70" : "border-leg/50 bg-leg/25 text-ink"}`}
                style={{ gridColumn: col, gridRow: 4 }}
                title={off ? `Trip ${trip.pairingNumber} comes off — vacation takes it` : `Trip ${trip.pairingNumber}`}
              >
                {trip.pairingNumber}
              </div>
            );
          })}
        </div>
      </div>

      {/* Slide the footprint across the legal offsets. */}
      {slides.length > 1 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-faint">
            <span>Earlier</span>
            <span className="text-ink-muted">Drag to slide your vacation</span>
            <span>Later</span>
          </div>
          <input
            type="range"
            min={0}
            max={slides.length - 1}
            step={1}
            value={picked ? asAwardedIdx : idx}
            onChange={(e) => pickSlider(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--color-accent)]"
            aria-label="Slide vacation earlier or later"
          />
        </div>
      )}

      {/* Our scored suggestions. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((o) => {
          const on = o.offset === selected.offset && o.expandBefore === selected.expandBefore && o.expandAfter === selected.expandAfter;
          return (
            <button
              key={`${o.offset}:${o.expandBefore}:${o.expandAfter}`}
              type="button"
              onClick={() => pickChip(o)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${on ? "border-accent bg-accent text-surface-raised" : "border-hairline text-ink-muted hover:text-ink"}`}
            >
              {moveWords(o)}
              {byModel && o.score !== null ? ` · ${o.score.toFixed(0)}` : ""}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        This vacation is worth {value} CH; a slide that takes more than that draws the extra from your bank (CBA 2026 7.G.1). Gold is your vacation; a struck trip comes off your line.
      </p>
    </div>
  );
}
