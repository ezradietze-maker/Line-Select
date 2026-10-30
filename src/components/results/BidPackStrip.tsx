"use client";

import type { ReactNode } from "react";
import { ScoreRing } from "@/components/results/ScoreRing";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { PackColumn, PackDay, PackToken } from "@/lib/bidpack-row";
import { PACK_TOKENS_PER_DAY } from "@/lib/bidpack-row";
import { formatHoursValue } from "@/lib/interview-config";
import type { Line } from "@/types/bidpack";

/**
 * The results list's first look at a line: the bid pack's own line strip, upgraded — its numbers on the left as the
 * pack prints them (CR., TAFB, C/O, DP'S, BLK., landings, days off) with the line's score, and the month a column a
 * day across the right, every flight number on the day it departs and the city the pilot lays over in, in the
 * calendar's colors (see `lib/bidpack-row.ts`). Tapping it opens everything else about the line under it.
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
}

export function stripLayout(listWidth: number, columns: number): StripLayout {
  const stacked = listWidth < 640;
  const col = (listWidth - 2 - GRIP_W - LEFT_W - CHEVRON_W - 2 * PAD_X) / Math.max(columns, 1);
  if (!stacked && col >= MIN_FIT_COL) return { mode: "fit", stacked, font: col >= 23 ? 9 : 8 };
  return { mode: "scroll", stacked, font: 9 };
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

/** What a strip's words and shading mean, once above the list — the pack's own marks, in the calendar's colors. */
export function StripKey({ className = "" }: { className?: string }) {
  const item = (swatch: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
  const word = (text: string, tone: string) => <span className={`font-mono text-[10px] font-semibold ${tone}`}>{text}</span>;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted ${className}`} aria-label="How to read a line's strip">
      {item(word("1875", "text-leg"), "flight, on the day it leaves")}
      {item(word("D/H", "text-deadhead"), "deadhead")}
      {item(word("HNL", "text-layover"), "where you lay over")}
      {item(word("HSBY", "text-standby"), "hotel standby")}
      {item(
        <span className="font-mono text-[10px] text-ink">
          <span className="font-semibold">76</span> <span className="text-ink-muted">60:27</span>
        </span>,
        "trip and its credit"
      )}
      {item(<span aria-hidden className="inline-block h-3 w-5 rounded-[3px] border-t-2 border-calendar-accent bg-calendar-accent/[0.14]" />, "on a trip")}
      <span>Tap a line for everything about it.</span>
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

interface BidPackStripProps {
  line: Line;
  score: number;
  /** A violated dealbreaker holds the score down. */
  capped: boolean;
  columns: PackColumn[];
  days: PackDay[];
  layout: StripLayout;
  /** The drag handle, when the list is in the pilot's own order. */
  grip: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function BidPackStrip({ line, score, capped, columns, days, layout, grip, open, onToggle }: BidPackStripProps) {
  const label = `Line ${line.lineNumber}, score ${Math.round(score)} — ${open ? "hide" : "show"} everything about it`;
  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <ScoreRing score={score} size={layout.stacked ? 34 : 38} capped={capped} />
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-semibold leading-[14px] tracking-wide text-ink">LINE {line.lineNumber}</div>
        <Numbers line={line} />
      </div>
    </div>
  );
  const chevron = <ChevronDownIcon className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />;

  if (layout.stacked || layout.mode === "scroll") {
    // The days scroll sideways under (a phone) or beside (a narrow laptop) the numbers, each strip with its own dates.
    const scroller = (
      <div className="min-w-0 overflow-x-auto overscroll-x-contain" onClick={onToggle}>
        <div style={{ width: columns.length * SCROLL_COL }}>
          <DateRows columns={columns} layout={layout} />
          <Days columns={columns} days={days} layout={layout} />
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
        <Days columns={columns} days={days} layout={layout} />
        <span className="flex justify-center">{chevron}</span>
      </button>
    </div>
  );
}
