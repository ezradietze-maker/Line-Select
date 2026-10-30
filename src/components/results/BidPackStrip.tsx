"use client";

import type { ReactNode } from "react";
import { ScoreRing } from "@/components/results/ScoreRing";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { PackColumn, PackDay, PackToken } from "@/lib/bidpack-row";
import { PACK_TOKENS_PER_DAY } from "@/lib/bidpack-row";
import { formatHoursValue } from "@/lib/interview-config";
import { sideBySide } from "@/lib/leg-bars";
import type { LineTimeline, TimelineLeg } from "@/lib/line-timeline";
import type { StripViewMode } from "@/lib/strip-view-storage";
import type { Line } from "@/types/bidpack";

/**
 * The results list's first look at a line, one of two ways (the pilot's toggle):
 *
 * - "pack": the bid pack's own line strip, upgraded — its numbers on the left as the pack prints them (CR., TAFB, C/O,
 *   DP'S, BLK., landings, days off) with the line's score, and the month a column a day across the right, every
 *   flight number on the day it departs and the city the pilot lays over in, in the calendar's colors
 *   (`lib/bidpack-row.ts`).
 * - "timeline": the same strip's size and everything on it, drawn as the month's one continuous timeline to scale
 *   (`lib/line-timeline.ts`): each duty a band from report to release with its flights in it, each layover a line with
 *   its city and hours, the flight numbers at the times they leave, the days off counted; and beside each of the
 *   line's numbers, where it sits among every line in the pack.
 *
 * Tapping either opens everything else about the line under it.
 */

/** The grip's column, the numbers' block and the chevron's column, in px — the date header lines up on the same. */
const GRIP_W = 24;
const LEFT_W = 204;
const CHEVRON_W = 22;
/** The strip's padding each side, inside its panel. */
const PAD_X = 8;
/** A day's printed rows: four words, then the trip's number and credit. */
const ROW_PX = 10;
/** Narrowest a day column gets on a laptop before the days scroll sideways instead; how wide they are then. */
const MIN_FIT_COL = 19;
const SCROLL_COL = 24;

/** How the strips are laid out at the list's width: every day across the strip, or scrolling sideways; and phone-stacked. */
export interface StripLayout {
  /** "fit": all the days across the strip, under one shared date header. "scroll": the days scroll, each strip with its own dates. */
  mode: "fit" | "scroll";
  /** A phone: the numbers above the days instead of beside them. */
  stacked: boolean;
  /** The words' size, px. */
  font: number;
  /** How wide the days are drawn, px — where the timeline's words have room. */
  daysPx: number;
}

export function stripLayout(listWidth: number, columns: number): StripLayout {
  const stacked = listWidth < 640;
  const fitPx = listWidth - 2 - GRIP_W - LEFT_W - CHEVRON_W - 2 * PAD_X;
  const col = fitPx / Math.max(columns, 1);
  if (!stacked && col >= MIN_FIT_COL) return { mode: "fit", stacked, font: col >= 23 ? 9 : 8, daysPx: fitPx };
  return { mode: "scroll", stacked, font: 9, daysPx: columns * SCROLL_COL };
}

const TOKEN_TONE: Record<PackToken["kind"], string> = {
  flight: "text-leg",
  deadhead: "text-deadhead",
  layover: "text-layover",
  standby: "text-standby",
};

function gridColumns(count: number, layout: StripLayout): string {
  return layout.mode === "fit" ? `repeat(${count}, minmax(0, 1fr))` : `repeat(${count}, ${SCROLL_COL}px)`;
}

/** A column's own lines: the pack's "|" before a week and before its weekend, weekends shaded, next month's days faint. */
function columnClass(col: PackColumn): string {
  return `${col.groupStart ? "border-l border-border-strong/50" : ""} ${col.weekend ? "bg-surface-raised/60" : ""} ${col.beyond ? "bg-ink/[0.035]" : ""}`;
}

/** What a strip's words, lines and shading mean, once above the list — for whichever strip the pilot is reading. */
export function StripKey({ view, className = "" }: { view: StripViewMode; className?: string }) {
  const item = (swatch: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
  const word = (text: string, tone: string) => <span className={`font-mono text-[10px] font-semibold ${tone}`}>{text}</span>;
  const trip = (
    <span className="font-mono text-[10px] text-ink">
      <span className="font-semibold">76</span> <span className="text-ink-muted">60:27</span>
    </span>
  );
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted ${className}`} aria-label="How to read a line's strip">
      {view === "pack" ? (
        <>
          {item(word("1875", "text-leg"), "flight, on the day it leaves")}
          {item(word("D/H", "text-deadhead"), "deadhead")}
          {item(word("HNL", "text-layover"), "where you lay over")}
          {item(word("HSBY", "text-standby"), "hotel standby")}
          {item(trip, "trip and its credit")}
          {item(<span aria-hidden className="inline-block h-3 w-5 rounded-[3px] border-t-2 border-calendar-accent bg-calendar-accent/[0.14]" />, "on a trip")}
        </>
      ) : (
        <>
          {item(
            <span aria-hidden className="relative inline-flex h-3 w-7 items-center rounded-[3px] bg-calendar-accent/30">
              <span className="absolute left-1.5 h-[3px] w-2.5 rounded-full bg-leg" />
              <span className="absolute right-1 h-[3px] w-1.5 rounded-full bg-deadhead" />
            </span>,
            "duty, report to release: flights blue, deadheads magenta, to scale"
          )}
          {item(<span aria-hidden className="inline-block h-[3px] w-5 rounded-full bg-layover" />, "layover")}
          {item(word("1875", "text-leg"), "flight number, when it leaves")}
          {item(trip, "trip and its credit")}
          {item(
            <span aria-hidden className="relative inline-block h-[3px] w-3 overflow-hidden rounded-full bg-ink/10">
              <span className="absolute inset-y-0 left-0 w-2/3 rounded-full bg-ink/45" />
            </span>,
            "where a number sits among the pack's lines"
          )}
        </>
      )}
      <span>Tap a line for everything about it.</span>
    </div>
  );
}

/** The pilot's switch between the two strips. */
export function StripViewToggle({ view, onChange }: { view: StripViewMode; onChange: (view: StripViewMode) => void }) {
  const option = (value: StripViewMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === value}
      onClick={() => onChange(value)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${view === value ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="How lines are shown" className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-surface p-0.5 print:hidden">
      {option("timeline", "Timeline")}
      {option("pack", "Bid pack")}
    </div>
  );
}

/** The two header rows over the days: weekday, then date — as the pack prints them once at the top of each page. */
function DateRows({ columns, layout }: { columns: PackColumn[]; layout: StripLayout }) {
  return (
    <div className="grid font-mono text-[9px] leading-[11px] text-ink-muted" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }} aria-hidden>
      {columns.map((c, i) => (
        <div key={i} className={`py-0.5 text-center ${columnClass(c)}`}>
          <div className={c.weekend ? "font-semibold text-ink" : ""}>{c.weekday ?? ""}</div>
          <div className={c.beyond ? "opacity-60" : "text-ink"}>{c.dayOfMonth}</div>
        </div>
      ))}
    </div>
  );
}

/** The shared date header over a list of strips laid out to fit — kept in view while the list scrolls. */
export function BidPackHeader({ columns, layout }: { columns: PackColumn[]; layout: StripLayout }) {
  if (layout.mode !== "fit") return null;
  return (
    <div className="sticky top-0 z-20 -mx-px rounded-t-lg border border-hairline bg-canvas/95 backdrop-blur print:static" style={{ paddingLeft: PAD_X + GRIP_W, paddingRight: PAD_X }}>
      <div className="grid" style={{ gridTemplateColumns: `${LEFT_W}px minmax(0, 1fr) ${CHEVRON_W}px` }}>
        <div className="self-end pb-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-faint">Line · score</div>
        <DateRows columns={columns} layout={layout} />
        <div />
      </div>
    </div>
  );
}

/**
 * One day: the trip's shading and rail, its words in the calendar's colors, and on a trip's first day its number and
 * credit — running on over the trip's next days (`labelRoom` columns, up to the next trip's own label), as the pack's
 * "6027" runs on under a trip's days; with room for only one day, just the number.
 */
function DayCell({ col, day, font, labelRoom }: { col: PackColumn; day: PackDay; font: number; labelRoom: number }) {
  const trip = day.trip;
  return (
    <div className={`relative ${columnClass(col)}`} style={{ height: (PACK_TOKENS_PER_DAY + 1) * ROW_PX + 6 }}>
      {trip && (
        <>
          <span className={`absolute inset-y-0 left-0 right-0 bg-calendar-accent/[0.14] ${trip.start ? "ml-px rounded-l-[3px]" : ""} ${trip.end ? "mr-px rounded-r-[3px]" : ""}`} />
          <span className={`absolute left-0 right-0 top-0 h-[2px] bg-calendar-accent ${trip.start ? "ml-px rounded-l-full" : ""} ${trip.end ? "mr-px rounded-r-full" : ""}`} />
        </>
      )}
      <div className="relative flex flex-col items-center pt-[4px] font-mono font-medium" style={{ fontSize: font, lineHeight: `${ROW_PX}px` }}>
        {day.tokens.map((t, i) => (
          <span key={i} className={`whitespace-nowrap ${TOKEN_TONE[t.kind]}`}>
            {t.text}
          </span>
        ))}
      </div>
      {day.label && (
        <span
          className="absolute bottom-[2px] left-[2px] z-10 overflow-hidden whitespace-nowrap font-mono text-ink"
          style={{ fontSize: font, lineHeight: `${ROW_PX}px`, maxWidth: `calc(${labelRoom * 100}% - 4px)` }}
          title={`Trip ${day.label.number ?? ""} · ${formatHoursValue(day.label.creditHours)} credit`}
        >
          <span className="font-semibold">{day.label.number ?? "—"}</span>
          {labelRoom > 1 && <span className="text-ink-muted"> {formatHoursValue(day.label.creditHours)}</span>}
        </span>
      )}
    </div>
  );
}

function Days({ columns, days, layout }: { columns: PackColumn[]; days: PackDay[]; layout: StripLayout }) {
  // How many columns each trip label may run over: to the next trip's label, or the strip's end.
  const room = (i: number) => {
    let n = 1;
    while (i + n < columns.length && !days[i + n]?.label) n++;
    return n;
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }}>
      {columns.map((c, i) => (
        <DayCell key={i} col={c} day={days[i] ?? { trip: null, label: null, tokens: [] }} font={layout.font} labelRoom={days[i]?.label ? room(i) : 1} />
      ))}
    </div>
  );
}

/** The line's own numbers, as the pack prints them left of its days. */
function Numbers({ line }: { line: Line }) {
  const rows: [string, string, string, string][] = [
    ["CR.", formatHoursValue(line.totalCreditHours), "TAFB", formatHoursValue(line.totalTafbHours)],
    ["C/O", formatHoursValue(line.carryOverCreditHours ?? 0), "DP'S", String(line.totalDutyPeriods ?? "—")],
    ["BLK.", line.totalBlockHours !== undefined ? formatHoursValue(line.totalBlockHours) : "—", "LDGS", String(line.totalLandings)],
    ["C/O", formatHoursValue(line.carryOverBlockHours ?? 0), "OFF", String(line.daysOff)],
  ];
  return (
    <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-1.5 font-mono text-[10px] leading-[11px]">
      {rows.map(([a, av, b, bv], i) => (
        <div key={i} className="contents">
          <span className="text-ink-faint">{a}</span>
          <span className="text-right tabular-nums text-ink">{av}</span>
          <span className="pl-1 text-ink-faint">{b}</span>
          <span className="text-right tabular-nums text-ink">{bv}</span>
        </div>
      ))}
    </div>
  );
}

/** The pack's range of each of a line's numbers, low to high — where one line sits among them all. */
export interface PackRanges {
  credit: [number, number];
  tafb: [number, number];
  coCredit: [number, number];
  dutyPeriods: [number, number];
  block: [number, number];
  landings: [number, number];
  coBlock: [number, number];
  daysOff: [number, number];
}

export function packRanges(lines: Line[]): PackRanges {
  const range = (f: (l: Line) => number): [number, number] => {
    const v = lines.map(f).filter((n) => Number.isFinite(n));
    return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
  };
  return {
    credit: range((l) => l.totalCreditHours),
    tafb: range((l) => l.totalTafbHours),
    coCredit: range((l) => l.carryOverCreditHours ?? 0),
    dutyPeriods: range((l) => l.totalDutyPeriods ?? NaN),
    block: range((l) => l.totalBlockHours ?? NaN),
    landings: range((l) => l.totalLandings),
    coBlock: range((l) => l.carryOverBlockHours ?? 0),
    daysOff: range((l) => l.daysOff),
  };
}

/** Which strip, and what it draws. */
export type StripView = { kind: "pack"; days: PackDay[] } | { kind: "timeline"; timeline: LineTimeline; ranges: PackRanges };

/** A small meter: where `value` sits between the pack's lowest and highest. */
function Meter({ value, range }: { value: number; range: [number, number] }) {
  const [lo, hi] = range;
  const share = hi > lo ? Math.min(Math.max((value - lo) / (hi - lo), 0), 1) : 0.5;
  return (
    <span aria-hidden className="relative inline-block h-[3px] w-3 shrink-0 self-center overflow-hidden rounded-full bg-ink/10">
      <span className="absolute inset-y-0 left-0 rounded-full bg-ink/45" style={{ width: `${Math.max(share * 100, 8)}%` }} />
    </span>
  );
}

/** The line's numbers, the pack's own, each with a meter: where it sits among every line in the pack. */
function RangedNumbers({ line, ranges }: { line: Line; ranges: PackRanges }) {
  const hm = formatHoursValue;
  const cells: [string, string, number, [number, number]][] = [
    ["CR", hm(line.totalCreditHours), line.totalCreditHours, ranges.credit],
    ["TAFB", hm(line.totalTafbHours), line.totalTafbHours, ranges.tafb],
    ["C/O", hm(line.carryOverCreditHours ?? 0), line.carryOverCreditHours ?? 0, ranges.coCredit],
    ["DP'S", String(line.totalDutyPeriods ?? "—"), line.totalDutyPeriods ?? 0, ranges.dutyPeriods],
    ["BLK", line.totalBlockHours !== undefined ? hm(line.totalBlockHours) : "—", line.totalBlockHours ?? 0, ranges.block],
    ["LDGS", String(line.totalLandings), line.totalLandings, ranges.landings],
    ["C/O", hm(line.carryOverBlockHours ?? 0), line.carryOverBlockHours ?? 0, ranges.coBlock],
    ["OFF", String(line.daysOff), line.daysOff, ranges.daysOff],
  ];
  return (
    <div className="grid grid-cols-[auto_auto_auto_auto_auto_auto] items-center gap-x-1 font-mono text-[10px] leading-[11px]" title="Each bar: where this line sits among every line in the pack, lowest to highest">
      {cells.map(([label, text, value, range], i) => (
        <span key={i} className="contents">
          <span className={`text-ink-faint ${i % 2 ? "pl-1.5" : ""}`}>{label}</span>
          <span className="text-right tabular-nums text-ink">{text}</span>
          <Meter value={value} range={range} />
        </span>
      ))}
    </div>
  );
}

const DAY_MIN = 24 * 60;
/** The timeline strip's rows, px from its top: the trip's rail and label, the duty track, the layover line, the cities, two lines of flight numbers. */
const TL = { rail: 0, label: 3, trackTop: 14, track: 14, duty: 12, bar: 3, lane: 2.5, cities: 34, flights: 45, line: 10, height: 66 };
const LEG_TONE: Record<TimelineLeg["kind"], { bar: string; text: string }> = {
  flight: { bar: "bg-leg", text: "text-leg" },
  deadhead: { bar: "bg-deadhead", text: "text-deadhead" },
  standby: { bar: "bg-standby", text: "text-standby" },
};

/** Words laid in up to two lines without touching: the first line when there's room, else the second, else pushed along. */
function twoLines(items: { x: number; w: number }[], maxRight: number): { x: number; row: 0 | 1 }[] {
  const right: [number, number] = [-Infinity, -Infinity];
  return items.map(({ x, w }) => {
    const fits = (r: 0 | 1) => x >= right[r] + 3;
    const row: 0 | 1 = fits(0) ? 0 : fits(1) ? 1 : right[0] <= right[1] ? 0 : 1;
    const placed = Math.min(Math.max(x, right[row] + 3), Math.max(maxRight - w, right[row] + 3));
    right[row] = placed + w;
    return { x: placed, row };
  });
}

/**
 * The month as one timeline, to scale on the base's clock: weekends shaded and the pack's week lines behind; each
 * trip's rail with its number and credit; each duty a grey band from report to release with its flights in it; each
 * layover a green line, its city and hours under it; every flight number at the time it leaves; and each run of days
 * off counted.
 */
function TimelineDays({ columns, timeline, layout }: { columns: PackColumn[]; timeline: LineTimeline; layout: StripLayout }) {
  const width = layout.daysPx;
  const total = columns.length * DAY_MIN;
  const x = (m: number) => (Math.min(Math.max(m, 0), total) / total) * width;
  const charPx = layout.font * 0.6;
  const font = { fontSize: layout.font, lineHeight: `${TL.line}px` };

  // Flight numbers: a deadhead run in one duty says "D/H" once.
  const legs = timeline.legs.filter((l, i) => !(l.kind === "deadhead" && timeline.legs[i - 1]?.kind === "deadhead" && timeline.legs[i - 1].end <= l.start && l.start - timeline.legs[i - 1].end < 6 * 60));
  const flightSpots = twoLines(
    legs.map((l) => ({ x: x(l.start), w: l.flight.length * charPx })),
    width
  );
  const stayLabels = timeline.stays.map((s) => `${s.city} ${Math.round(s.hours)}h`);
  const stayCenters = sideBySide(
    timeline.stays.map((s, i) => ({ at: ((s.start + s.end) / 2 / total) * DAY_MIN, text: stayLabels[i] })),
    width,
    0
  );

  return (
    <div className="relative" style={{ height: TL.height, width: layout.mode === "fit" ? undefined : width }}>
      {/* The days behind: the pack's week lines, weekends shaded, next month faint. */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }} aria-hidden>
        {columns.map((c, i) => (
          <div key={i} className={columnClass(c)} />
        ))}
      </div>
      {timeline.offRuns.map((r, i) => {
        const w = r.length * (width / columns.length);
        const text = r.length === 1 ? "off" : w >= (r.length + 9) * charPx ? `${r.length} days off` : `${r.length} off`;
        return (
          <span key={`o${i}`} className="absolute flex items-center justify-center whitespace-nowrap font-mono text-ink-faint" style={{ ...font, left: (r.day / columns.length) * width, width: w, top: TL.trackTop, height: TL.track }}>
            {text}
          </span>
        );
      })}
      {timeline.trips.map((t, i) => {
        const left = x(t.start);
        const next = timeline.trips[i + 1];
        const room = (next ? x(next.start) : width) - left - 3;
        const number = t.number ?? "—";
        const credit = formatHoursValue(t.creditHours);
        // The credit when there's room for it before the next trip's label; else the number alone, never cut mid-word.
        const withCredit = (number.length + 1 + credit.length) * charPx <= room;
        return (
          <span key={`t${i}`}>
            <span className="absolute h-[2px] rounded-full bg-calendar-accent" style={{ left, width: Math.max(2, x(t.end) - left), top: TL.rail }} />
            <span className="absolute whitespace-nowrap font-mono text-ink" style={{ ...font, left, top: TL.label }} title={`Trip ${number} · ${credit} credit · ${t.days} days`}>
              <span className="font-semibold">{number}</span>
              {withCredit && <span className="text-ink-muted"> {credit}</span>}
            </span>
          </span>
        );
      })}
      {timeline.duties.map((d, i) => (
        <span key={`d${i}`} className="absolute rounded-[3px] bg-calendar-accent/30" style={{ left: x(d.start) - 1, width: Math.max(3, x(d.end) - x(d.start) + 2), top: TL.trackTop + (TL.track - TL.duty) / 2, height: TL.duty }} />
      ))}
      {timeline.legs.map((l, i) => (
        <span key={`l${i}`} className={`absolute rounded-full ${LEG_TONE[l.kind].bar}`} style={{ left: x(l.start), width: Math.max(2, x(l.end) - x(l.start)), top: TL.trackTop + TL.track / 2 - TL.bar / 2, height: TL.bar }} title={`${l.flight} ${l.from}–${l.to}`} />
      ))}
      {timeline.stays.map((s, i) => (
        <span key={`s${i}`} className="absolute rounded-full bg-layover" style={{ left: x(s.start) + 1, width: Math.max(2, x(s.end) - x(s.start) - 2), top: TL.trackTop + TL.track + 1, height: TL.lane }} />
      ))}
      {timeline.stays.map((s, i) => (
        <span key={`c${i}`} className="absolute -translate-x-1/2 whitespace-nowrap font-mono font-semibold text-layover" style={{ ...font, left: stayCenters[i], top: TL.cities }} title={`Layover in ${s.city}, ${Math.round(s.hours)}h`}>
          {s.city}
          <span className="font-normal"> {Math.round(s.hours)}h</span>
        </span>
      ))}
      {legs.map((l, i) => (
        <span key={`f${i}`} className={`absolute whitespace-nowrap font-mono font-medium ${LEG_TONE[l.kind].text}`} style={{ ...font, left: flightSpots[i].x, top: TL.flights + flightSpots[i].row * TL.line }}>
          {l.flight}
        </span>
      ))}
    </div>
  );
}

interface BidPackStripProps {
  line: Line;
  score: number;
  /** A violated dealbreaker holds the score down. */
  capped: boolean;
  columns: PackColumn[];
  view: StripView;
  layout: StripLayout;
  /** The drag handle, when the list is in the pilot's own order. */
  grip: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function BidPackStrip({ line, score, capped, columns, view, layout, grip, open, onToggle }: BidPackStripProps) {
  const label = `Line ${line.lineNumber}, score ${Math.round(score)} — ${open ? "hide" : "show"} everything about it`;
  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <ScoreRing score={score} size={layout.stacked ? 34 : 38} capped={capped} />
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-semibold leading-[14px] tracking-wide text-ink">LINE {line.lineNumber}</div>
        {view.kind === "pack" ? <Numbers line={line} /> : <RangedNumbers line={line} ranges={view.ranges} />}
      </div>
    </div>
  );
  const drawn =
    view.kind === "pack" ? <Days columns={columns} days={view.days} layout={layout} /> : <TimelineDays columns={columns} timeline={view.timeline} layout={layout} />;
  const chevron = <ChevronDownIcon className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />;

  if (layout.stacked || layout.mode === "scroll") {
    // The days scroll sideways under (a phone) or beside (a narrow laptop) the numbers, each strip with its own dates.
    const scroller = (
      <div className="min-w-0 overflow-x-auto overscroll-x-contain" onClick={onToggle}>
        <div style={{ width: columns.length * SCROLL_COL }}>
          <DateRows columns={columns} layout={layout} />
          {drawn}
        </div>
      </div>
    );
    return layout.stacked ? (
      <div className="py-1.5" style={{ paddingLeft: PAD_X, paddingRight: PAD_X }}>
        <div className="flex items-center gap-1">
          {grip}
          <button type="button" onClick={onToggle} aria-expanded={open} aria-label={label} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
            {title}
            {chevron}
          </button>
        </div>
        <div className="mt-1">{scroller}</div>
      </div>
    ) : (
      <div className="flex items-stretch" style={{ paddingRight: PAD_X }}>
        <div className="flex shrink-0 items-center justify-center" style={{ width: GRIP_W + PAD_X }}>
          {grip}
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={label} className="flex shrink-0 items-center py-1.5 text-left" style={{ width: LEFT_W }}>
          {title}
        </button>
        <div className="min-w-0 flex-1 py-1">{scroller}</div>
        <button type="button" onClick={onToggle} aria-hidden tabIndex={-1} className="flex shrink-0 items-center justify-center" style={{ width: CHEVRON_W }}>
          {chevron}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-stretch" style={{ paddingRight: PAD_X }}>
      <div className="flex shrink-0 items-center justify-center" style={{ width: GRIP_W + PAD_X }}>
        {grip}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={label}
        className="grid min-w-0 flex-1 items-center py-1 text-left"
        style={{ gridTemplateColumns: `${LEFT_W}px minmax(0, 1fr) ${CHEVRON_W}px` }}
      >
        {title}
        {drawn}
        <span className="flex justify-center">{chevron}</span>
      </button>
    </div>
  );
}
