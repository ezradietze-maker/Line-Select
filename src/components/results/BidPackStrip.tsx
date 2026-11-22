"use client";

import { useId, type ReactNode } from "react";
import { ScoreRing } from "@/components/results/ScoreRing";
import { formatIndex } from "@/lib/satisfaction-index";
import { reachSpans, type LineVacationMark } from "@/lib/vacation-marks";
import { ChevronDownIcon } from "@/components/ui/icons";
import { PillHighlight } from "@/components/ui/PillHighlight";
import type { PackColumn, PackDay, PackToken } from "@/lib/bidpack-row";
import { PACK_TOKENS_PER_DAY } from "@/lib/bidpack-row";
import { HEAT_GRADIENT, heatColor } from "@/lib/heat-scale";
import { formatHoursValue } from "@/lib/interview-config";
import { heatPieceText, sharePercents, type HeatPiece, type LineHeat } from "@/lib/line-heat";
import { HeatShareLine } from "@/components/results/HeatReasons";
import { dutyRoutes, laneLabels, placeVariants, routesOf, routeText, routeTextVariants } from "@/lib/line-route";
import type { LineTimeline, TimelineLeg } from "@/lib/line-timeline";
import type { StripViewMode } from "@/lib/strip-view-storage";
import type { Line } from "@/types/bidpack";

/**
 * The results list's first look at a line, one of three ways (the pilot's toggle):
 *
 * - "pack": the bid pack's own line strip, upgraded — its numbers on the left as the pack prints them (CR., TAFB, C/O,
 *   DP'S, BLK., landings, days off) with the line's score, and the month a column a day across the right, every
 *   flight number on the day it departs and the city the pilot lays over in, in the calendar's colors
 *   (`lib/bidpack-row.ts`).
 * - "timeline": everything the pack prints for the line, organised by trip on the month's timeline (`lib/line-route.ts`):
 *   each trip one card from report to release with its number and credit, its flights and layovers inside as one route
 *   — every flight number over its own leg, every city under its own layover — the pack's "---" on each day off, and
 *   the pack's eight numbers in words.
 * - "heat": the Timeline, its route a band of colour — each duty period and layover as hot (good for this pilot) or as
 *   cold (bad) as it is for them (`lib/line-heat.ts`), the pack's words kept around it — and how much of the line's
 *   time on trips runs hot, mild and cold.
 *
 * Tapping any of them opens everything else about the line under it.
 */

/** The grip's column, the numbers' block and the chevron's column, in px — the date header lines up on the same. */
const GRIP_W = 24;
// Room for the ring and the spelled-out numbers on one line each ("C/O blk 0:00 Days off 15" needs 174px): at 204 they
// wrapped, and the last column ran under the line's first trip. 16 more for the Satisfaction Index's decimal.
const LEFT_W = 240;
/** The Timeline's: only the score, its place and the line's number beside the days, so the days have the room. */
export const TIMELINE_LEFT_W = 172;
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
  /**
   * How many times the usual size the pilot's browser sets its text (`useTextScale`). The numbers' block, the grip and
   * the chevron are that much wider, so their words fit as they grow; the days are px and keep their size.
   */
  textScale: number;
  /** The block beside the days (score, line number and, but for the Timeline, its numbers), px before `textScale`. */
  leftW: number;
}

/**
 * The largest size, 7 to 9 px, at which a day's longest word (a four-figure flight number, in a monospaced face about
 * 0.6 of its size wide) fits its column with a little air either side. A fixed 8px on a 22px column let one day's
 * "0215" run into the next day's "2335", and the strip read "021523352335233".
 */
export function fitFont(col: number): number {
  return Math.max(7, Math.min(9, Math.floor((col - 3) / (4 * 0.6))));
}

export function stripLayout(listWidth: number, columns: number, textScale = 1, leftW = LEFT_W): StripLayout {
  // At 200% text the numbers beside the days need twice the room, and the list stacks where a phone's would: given
  // 224px, "Credit", "Block", "C/O cr" ran over each other and the last column ran under the line's first trip.
  const k = Math.max(1, textScale);
  const stacked = listWidth < 640 * k;
  const fitPx = listWidth - 2 - (GRIP_W + leftW + CHEVRON_W + 2 * PAD_X) * k;
  const col = fitPx / Math.max(columns, 1);
  if (!stacked && col >= MIN_FIT_COL) return { mode: "fit", stacked, font: fitFont(col), daysPx: fitPx, textScale: k, leftW };
  return { mode: "scroll", stacked, font: 9, daysPx: columns * SCROLL_COL, textScale: k, leftW };
}

/** How wide the list prints: an A4 or Letter sheet's width inside its 12mm margins (globals.css `@page`), a little to spare. */
export const PRINT_LIST_PX = 680;

/**
 * The strips as printed, whatever the screen: the numbers above the days, and every day across the sheet. Laid out at
 * the screen's width they were cut off at the sheet's edge, a laptop's at about the 16th, and a phone's days don't
 * scroll on paper.
 */
export function printStripLayout(columns: number): StripLayout {
  const daysPx = PRINT_LIST_PX - 2 - 2 * PAD_X;
  const col = daysPx / Math.max(columns, 1);
  // Narrower than a laptop ever lays them out, with five weeks of a pack across: a size smaller, so a day's four
  // letters don't run into the next day's.
  return { mode: "fit", stacked: true, font: col >= 23 ? 9 : col >= MIN_FIT_COL ? 8 : 7, daysPx, textScale: 1, leftW: LEFT_W };
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
export function StripKey({ view, hint = "Tap a line for everything about it.", className = "", vacation = false }: { view: StripViewMode; hint?: string; className?: string; vacation?: boolean }) {
  // An item stays on one line while it fits; a long one wraps on a narrow phone rather than push the page sideways.
  const item = (swatch: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5 [&>:first-child]:shrink-0">
      {swatch}
      {label}
    </span>
  );
  const word = (text: string, tone: string) => <span className={`font-mono text-2xs font-semibold ${tone}`}>{text}</span>;
  const trip = (
    <span className="font-mono text-2xs text-ink">
      <span className="font-semibold">76</span> <span className="text-ink-muted">60:27</span>
    </span>
  );
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-muted ${className}`} role="group" aria-label="How to read a line's strip">
      {view === "heat" ? (
        <>
          {/* No wider than the key: at 320px and 200% text "Hot" ran 7px off the side; the scale gives the room. */}
          <span className="inline-flex max-w-full items-center gap-1.5">
            Cold
            <span aria-hidden className="inline-block h-2.5 w-24 rounded-[2px] border border-border-strong/60" style={{ background: HEAT_GRADIENT }} />
            Hot
          </span>
          <span>each duty period and layover, colder the worse it is for you, hotter the better</span>
          {item(word("---", "text-ink-faint"), "day off")}
        </>
      ) : view === "pack" ? (
        <>
          {item(word("1875", "text-leg"), "flight, on the day it leaves")}
          {item(word("D/H", "text-deadhead"), "deadhead")}
          {item(word("HNL", "text-layover"), "where you lay over")}
          {item(word("HSBY", "text-standby"), "hotel standby")}
          {item(trip, "trip and its credit")}
          {item(<span aria-hidden className="inline-block h-3 w-5 rounded-[3px] border-t-2 border-calendar-accent bg-trip-wash" />, "on a trip")}
        </>
      ) : (
        <>
          {item(
            <svg aria-hidden width="30" height="9" className="overflow-visible">
              <rect x="-2" y="0" width="34" height="9" rx="2" fill="var(--color-trip-band)" />
              <line x1="1" x2="29" y1="4.5" y2="4.5" stroke="var(--color-leg)" strokeWidth="3" />
              <line x1="1.75" x2="1.75" y1="0.5" y2="8.5" stroke="var(--color-leg)" strokeWidth="1.5" />
              <line x1="28.25" x2="28.25" y1="0.5" y2="8.5" stroke="var(--color-leg)" strokeWidth="1.5" />
            </svg>,
            "flight, takeoff to landing, in its duty period"
          )}
          {item(word("MEM-PVG", "text-ink"), "where it flies")}
          {item(<span aria-hidden className="inline-block h-[3px] w-6 rounded-full bg-deadhead" />, "deadhead")}
          {item(<span aria-hidden className="inline-block h-[3px] w-6 rounded-full bg-standby" />, "hotel standby")}
          {item(
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-[3px] w-6 rounded-full bg-layover" />
              {word("PVG 28h", "text-layover")}
            </span>,
            "layover, as long as it lasts"
          )}
          {item(<span className="rounded-[4px] border border-border-strong bg-surface-raised px-1">{trip}</span>, "trip and its credit")}
          {item(word("---", "text-ink-faint"), "day off")}
        </>
      )}
      {/* The pilot's vacation, on every line: where it falls, how far it can slide, what it takes off. */}
      {vacation && (
        <>
          {item(
            <span aria-hidden className="relative inline-block h-3 w-7 rounded-[2px] bg-accent/15">
              <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-[2px] bg-accent" />
            </span>,
            "your vacation"
          )}
          {item(<span aria-hidden className="inline-block h-[5px] w-6 opacity-80" style={{ backgroundImage: HATCH }} />, "how far it can slide")}
          {view !== "heat" && item(<span aria-hidden className="inline-block h-3 w-5 rounded-[3px] border border-dashed border-accent bg-surface/60" />, "a trip it takes off, paid from your bank")}
          {item(<span aria-hidden className="inline-block h-[3px] w-6 border-t-[3px] border-dotted border-accent" />, "free time a long trip needs beside it")}
        </>
      )}
      <span>{view === "heat" ? `Point at a piece for why. ${hint}` : hint}</span>
    </div>
  );
}

/** The pilot's switch between the strips. */
export function StripViewToggle({ view, onChange }: { view: StripViewMode; onChange: (view: StripViewMode) => void }) {
  const group = useId();
  const option = (value: StripViewMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === value}
      onClick={() => onChange(value)}
      className={`relative rounded-[3px] px-3 py-1 text-xs font-medium transition-colors duration-300 ${view === value ? "text-canvas" : "text-ink-muted hover:text-ink"}`}
    >
      {view === value && <PillHighlight group={group} className="absolute inset-0 rounded-[3px] bg-ink" />}
      <span className="relative z-10">{label}</span>
    </button>
  );
  // No wider than its row: with a phone's text set larger, "Bid pack" goes over two lines rather than off the side, and
  // where even then the three won't fit (320px at 150% text and up) "Heat Map" goes under; on one row it cut "Timeline".
  return (
    <div role="radiogroup" aria-label="How lines are shown" className="inline-flex max-w-full shrink-0 flex-wrap items-center justify-end rounded-[3px] border border-hairline bg-surface p-0.5 print:hidden">
      {option("timeline", "Timeline")}
      {option("pack", "Bid pack")}
      {option("heat", "Heat Map")}
    </div>
  );
}

/**
 * The two header rows over the days: weekday, then date — as the pack prints them once at the top of each page. Set in
 * px, as the day columns under them are: at 200% text "MO" was wider than its day and the header read "MOTUWETHFR".
 */
function DateRows({ columns, layout }: { columns: PackColumn[]; layout: StripLayout }) {
  return (
    <div className="grid font-mono text-[11px] leading-[11px] text-ink-muted" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }} aria-hidden>
      {columns.map((c, i) => (
        <div key={i} className={`py-0.5 text-center ${columnClass(c)}`}>
          <div className={c.weekend ? "font-semibold text-ink" : ""}>{c.weekday ?? ""}</div>
          <div className={c.beyond ? "text-ink-faint" : "text-ink"}>{c.dayOfMonth}</div>
        </div>
      ))}
    </div>
  );
}

/** The shared date header over a list of strips laid out to fit — kept in view while the list scrolls, unless `sticky` is off. */
export function BidPackHeader({ columns, layout, label = "Line · score", sticky = true }: { columns: PackColumn[]; layout: StripLayout; label?: string; sticky?: boolean }) {
  // Stacked (printed), each strip has its own dates over its days.
  if (layout.mode !== "fit" || layout.stacked) return null;
  const k = layout.textScale;
  return (
    <div className={`${sticky ? "sticky top-0 z-20" : ""} -mx-px rounded-t-lg border border-hairline bg-canvas/95 backdrop-blur print:static`} style={{ paddingLeft: (PAD_X + GRIP_W) * k, paddingRight: PAD_X * k }}>
      <div className="grid" style={{ gridTemplateColumns: `${layout.leftW * k}px minmax(0, 1fr) ${CHEVRON_W * k}px` }}>
        <div className="self-end pb-0.5 text-2xs text-ink-faint font-medium">{label}</div>
        <DateRows columns={columns} layout={layout} />
        <div />
      </div>
    </div>
  );
}

/**
 * One day: the trip's shading and rail, its words in the calendar's colors, and on a trip's first day its number and
 * credit — running on over the trip's next days (`labelRoom` columns, up to the next trip's own label), as the pack's
 * "6027" runs on under a trip's days; with room for only one day, or not enough for both (`creditFits`), just the number.
 */
function DayCell({ col, day, font, labelRoom, credit }: { col: PackColumn; day: PackDay; font: number; labelRoom: number; credit: boolean }) {
  const trip = day.trip;
  return (
    <div className={`relative ${columnClass(col)}`} style={{ height: (PACK_TOKENS_PER_DAY + 1) * ROW_PX + 6 }}>
      {trip && (
        <>
          <span className={`absolute inset-y-0 left-0 right-0 bg-trip-wash ${trip.start ? "ml-px rounded-l-[3px]" : ""} ${trip.end ? "mr-px rounded-r-[3px]" : ""}`} />
          <span className={`absolute left-0 right-0 top-0 h-[2px] bg-calendar-accent ${trip.start ? "ml-px rounded-l-full" : ""} ${trip.end ? "mr-px rounded-r-full" : ""}`} />
        </>
      )}
      {/* Clipped to its own day: whatever still doesn't fit is cut at the column's edge, never run into the next day. */}
      <div className="relative flex flex-col items-center overflow-hidden pt-[4px] font-mono font-medium" style={{ fontSize: font, lineHeight: `${ROW_PX}px` }}>
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
          {credit && <span className="text-ink-muted"> {formatHoursValue(day.label.creditHours)}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * Whether a trip's label has room for its credit after its number. `dayPx` is its first day's width inside the week's
 * line, which the label's room is counted in (`labelRoom` days of it, less 2px either side), and half a pixel's grace
 * for the estimate: a two-day trip with another the day after it read "134 10:1", its credit cut at the label's edge.
 */
export function creditFits(number: string, creditHours: number, labelRoom: number, dayPx: number, font: number): boolean {
  return (number.length + 1 + formatHoursValue(creditHours).length) * font * MONO_ADVANCE <= labelRoom * dayPx - 3.5;
}

function Days({ columns, days, layout, vacation }: { columns: PackColumn[]; days: PackDay[]; layout: StripLayout; vacation?: LineVacationMark | null }) {
  // How many columns each trip label may run over: to the next trip's label, or the strip's end.
  const room = (i: number) => {
    let n = 1;
    while (i + n < columns.length && !days[i + n]?.label) n++;
    return n;
  };
  const colPx = layout.mode === "fit" ? layout.daysPx / Math.max(columns.length, 1) : SCROLL_COL;
  return (
    <div className="relative">
      <div className="grid" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }}>
        {columns.map((c, i) => {
          const label = days[i]?.label;
          const labelRoom = label ? room(i) : 1;
          // A week's first day has its line inside it, a pixel off the room.
          const credit = !!label && labelRoom > 1 && creditFits(label.number ?? "—", label.creditHours, labelRoom, colPx - (c.groupStart ? 1 : 0), layout.font);
          return <DayCell key={i} col={c} day={days[i] ?? { trip: null, label: null, tokens: [] }} font={layout.font} labelRoom={labelRoom} credit={credit} />;
        })}
      </div>
      {vacation && <VacationDays mark={vacation} columns={columns.length} layout={layout} />}
    </div>
  );
}

/** A hatch in the vacation's colour: the days it could slide over. */
const HATCH = "repeating-linear-gradient(135deg, var(--color-accent) 0 1.5px, transparent 1.5px 4px)";

/**
 * The vacation over the pack view's days: each of its days washed gold, a gold bar along their top, the
 * days it could slide to hatched either side, and where the pack had it outlined when it's slid. Over the days, but
 * clear of taps: the strip opens as before.
 */
function VacationDays({ mark, columns, layout }: { mark: LineVacationMark; columns: number; layout: StripLayout }) {
  const col = (d: number) => Math.min(Math.max(d, 0), columns - 1) + 1;
  const inView = (a: number, b: number) => b >= 0 && a <= columns - 1;
  return (
    <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: gridColumns(columns, layout) }} aria-hidden>
      {mark.pieces.flatMap((p) => {
        const reach = reachSpans(p);
        const before = reach.before ? [p.firstDay - Math.round((reach.before[1] - reach.before[0]) / 1440), p.firstDay - 1] : null;
        const after = reach.after ? [p.lastDay + 1, p.lastDay + Math.round((reach.after[1] - reach.after[0]) / 1440)] : null;
        const slid = p.firstDay !== p.awardedFirstDay;
        const out = [];
        if (slid && inView(p.awardedFirstDay, p.awardedLastDay))
          out.push(<div key={`${p.id}a`} className="rounded-[3px] border border-dashed border-accent/70" style={{ gridColumn: `${col(p.awardedFirstDay)} / ${col(p.awardedLastDay) + 1}`, gridRow: 1 }} />);
        if (inView(p.firstDay, p.lastDay))
          out.push(
            // No "VAC 7" here: the pack's own words fill every cell, and the key says what gold is.
            <div key={`${p.id}v`} className="relative rounded-[3px] bg-accent/12" style={{ gridColumn: `${col(p.firstDay)} / ${col(p.lastDay) + 1}`, gridRow: 1 }} title={`Your vacation, ${p.days} days`}>
              <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-[3px] bg-accent" />
            </div>
          );
        for (const [k, r] of [["b", before], ["f", after]] as const)
          if (r && inView(r[0], r[1]))
            out.push(<div key={`${p.id}${k}`} className="h-[5px] self-start opacity-80" style={{ gridColumn: `${col(r[0])} / ${col(r[1]) + 1}`, gridRow: 1, backgroundImage: HATCH }} />);
        return out;
      })}
      {/* The free time a long trip needs beside the vacation, where a trip that isn't under it fell in: why it comes off. */}
      {mark.freeWindows.map((w, i) =>
        inView(w.firstDay, w.lastDay) ? (
          <div key={`free${i}`} className="self-start border-t-[3px] border-dotted border-accent" style={{ gridColumn: `${col(w.firstDay)} / ${col(w.lastDay) + 1}`, gridRow: 1 }} title={w.title} data-vacation-free />
        ) : null
      )}
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
    <NumberColumns rows={rows} className="gap-x-1.5 font-mono text-2xs leading-[0.6875rem]" label="text-ink-faint" value="text-right tabular-nums text-ink" />
  );
}

/**
 * The numbers' two pairs of columns, side by side where there's room, the second under the first where there isn't: on
 * a phone with its text set larger (130–150%), TAFB, Duties, Landings and Days off ran off the card's edge, under the
 * chevron, and their numbers were cut. Each pair is its own grid, so side by side they read as the one table they were.
 */
function NumberColumns({ rows, className, label, value, cells = "" }: { rows: [string, string, string, string][]; className: string; label: string; value: string; cells?: string }) {
  const pair = (side: 0 | 1) => (
    <div className={`grid grid-cols-[auto_auto] whitespace-nowrap ${className} ${cells}`}>
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <span className={`${side ? "pl-1 " : ""}${label}`}>{r[side * 2]}</span>
          <span className={value}>{r[side * 2 + 1]}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className={`flex flex-wrap ${className}`}>
      {pair(0)}
      {pair(1)}
    </div>
  );
}

/** Which strip, and what it draws. */
export type StripView = { kind: "pack"; days: PackDay[] } | { kind: "timeline"; timeline: LineTimeline } | { kind: "heat"; timeline: LineTimeline; heat: LineHeat };

/** The same eight numbers the pack prints left of a line, in words a pilot reads at a glance. */
function SpelledNumbers({ line }: { line: Line }) {
  const hm = formatHoursValue;
  const rows: [string, string, string, string][] = [
    ["Credit", hm(line.totalCreditHours), "TAFB", hm(line.totalTafbHours)],
    ["Block", line.totalBlockHours !== undefined ? hm(line.totalBlockHours) : "—", "Duties", String(line.totalDutyPeriods ?? "—")],
    ["C/O cr", hm(line.carryOverCreditHours ?? 0), "Landings", String(line.totalLandings)],
    ["C/O blk", hm(line.carryOverBlockHours ?? 0), "Days off", String(line.daysOff)],
  ];
  return <NumberColumns rows={rows} className="gap-x-[5px] text-2xs leading-[0.75rem]" cells="items-baseline" label="text-ink-muted" value="text-right font-mono tabular-nums text-ink" />;
}

const DAY_MIN = 24 * 60;
/** The Timeline strip's rows, px from its top: the trips' numbers, their cards, the route, its flight-number lanes over it and city lanes under it. */
const RT = { height: 71, header: 9, card: 11, route: 46, flightLanes: [41, 31, 21], cityLanes: [57, 66] };
/** The Heat Map's: the same, with a band of heat in place of the route line (`band`: its top and height). */
const HT = { height: 76, header: 9, card: 11, route: 45, band: [39, 12] as const, flightLanes: [36, 27, 19], cityLanes: [61, 70] };
const LEG_COLOR: Record<TimelineLeg["kind"], string> = {
  flight: "var(--color-leg)",
  deadhead: "var(--color-deadhead)",
  standby: "var(--color-standby)",
};
/** Overpass Mono's advance, per px of font size: how wide a word is drawn (measured: 0.616). */
const MONO_ADVANCE = 0.616;

/**
 * The Timeline: every word the pack prints for the line, organised by trip, on the base's clock. Each trip is one card
 * from report to release with its number and credit over it; inside, its flights and layovers run as one route — each
 * flight a line with tick ends from takeoff to landing and its number over it (a deadhead run dashed, "D/H"), each
 * layover a green stretch as long as it lasts with its city under it, each wait at an airport between legs a thin line.
 * The pack's "---" on each day off. Words sit in lanes and never touch (`laneLabels`).
 */
function RouteDays({ columns, timeline, layout, heat, vacation }: { columns: PackColumn[]; timeline: LineTimeline; layout: StripLayout; heat?: LineHeat; vacation?: LineVacationMark | null }) {
  const hatchId = useId().replace(/:/g, "");
  const G = heat ? HT : RT;
  const width = layout.daysPx;
  const total = columns.length * DAY_MIN;
  const x = (m: number) => (Math.min(Math.max(m, 0), total) / total) * width;
  const colPx = width / columns.length;
  const font = layout.font;
  const charPx = font * MONO_ADVANCE;
  const headerFont = font + 0.5;
  const routes = routesOf(timeline);

  const cards = routes.map((r) => ({ left: x(r.trip.start), right: Math.max(x(r.trip.end), x(r.trip.start) + 6), trip: r.trip }));
  const flights = routes.flatMap((r) => r.legs.map((l) => ({ ...l, at: (x(l.start) + x(l.end)) / 2, width: l.label.length * charPx })));
  const flightSpots = laneLabels(flights, G.flightLanes.length, width);
  const stays = routes.flatMap((r) => r.stays.map((s) => ({ ...s, at: (x(s.start) + x(s.end)) / 2, width: s.city.length * charPx })));
  const citySpots = laneLabels(stays, G.cityLanes.length, width);
  // Each trip's number and its credit from its card's left edge: a crowded one moves along rather than covering the one
  // before. The credit only where it has room before the next card, as the pack strip says just the number of a day
  // trip with another the next day: on a phone, a run of day trips' "31 6:24"s pushed the next trip's number days off
  // its card. The card's own title still says it.
  const fullWidth = (number: string, credit: string) => (number.length + 1 + credit.length) * headerFont * MONO_ADVANCE;
  const headerText = cards.map((c, i) => {
    const number = c.trip.number ?? "—";
    const credit = formatHoursValue(c.trip.creditHours);
    const next = cards[i + 1];
    return { number, credit: !next || c.left + 1 + fullWidth(number, credit) + 6 <= next.left ? credit : "" };
  });
  const headerWidths = headerText.map((h) => (h.credit ? fullWidth(h.number, h.credit) : h.number.length * headerFont * MONO_ADVANCE));
  const headerSpots = laneLabels(cards.map((c, i) => ({ at: c.left + 1 + headerWidths[i] / 2, width: headerWidths[i] })), 1, Infinity, 6);
  const headers = headerText.map((h, i) => ({ ...h, left: headerSpots[i].x }));
  const offDays = timeline.offRuns.flatMap((r) => Array.from({ length: r.length }, (_, k) => r.day + k));

  return (
    <div className="relative" style={{ height: G.height, width: layout.mode === "fit" ? undefined : width }}>
      {/* The days behind: the pack's week lines, weekends shaded, next month faint. */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }} aria-hidden>
        {columns.map((c, i) => (
          <div key={i} className={columnClass(c)} />
        ))}
      </div>
      <svg className="absolute inset-0 overflow-visible font-mono" width={width} height={G.height} aria-hidden>
        {/* On the Heat Map the vacation is its bar, hashes and outline only: the colours belong to the heat. */}
        {vacation && <VacationLayer mark={vacation} x={x} height={G.height} wash={!heat} id={hatchId} />}
        {offDays.map((d) => {
          const cx = (d + 0.5) * colPx;
          if (cards.some((c) => cx + 9 > c.left && cx - 9 < c.right)) return null;
          return (
            <text key={`o${d}`} x={cx} y={G.route + 3} textAnchor="middle" fontSize={font} fill="var(--color-ink-faint)">
              ---
            </text>
          );
        })}
        {cards.map((c, i) => (
          <rect key={`c${i}`} x={c.left} y={G.card} width={c.right - c.left} height={G.height - G.card - 1} rx={5} fill="var(--color-surface-raised)" stroke="var(--color-border-strong)">
            <title>{`Trip ${c.trip.number ?? ""} · ${formatHoursValue(c.trip.creditHours)} credit · ${c.trip.days} days`}</title>
          </rect>
        ))}
        {routes.flatMap((r, i) =>
          r.waits.map((w, k) => <line key={`w${i}-${k}`} x1={x(w.start)} x2={x(w.end)} y1={G.route} y2={G.route} stroke="var(--color-ink-faint)" strokeWidth={1} />)
        )}
        {heat ? (
          <HeatBand pieces={heat.pieces} x={x} />
        ) : (
          <>
        {stays.map((s, i) => (
          <line key={`s${i}`} x1={x(s.start) + 1} x2={Math.max(x(s.start) + 2, x(s.end) - 1)} y1={G.route} y2={G.route} stroke="var(--color-layover)" strokeWidth={4} strokeLinecap="round" opacity={0.85}>
            <title>{`Layover in ${s.city}, ${Math.round(s.hours)}h`}</title>
          </line>
        ))}
        {flights.map((l, i) => {
          const a = x(l.start);
          const b = Math.max(x(l.end), a + 3);
          const color = LEG_COLOR[l.kind];
          return (
            <g key={`l${i}`} stroke={color}>
              <title>{`${l.label} ${l.from}–${l.to}`}</title>
              <line x1={a} x2={b} y1={G.route} y2={G.route} strokeWidth={2} strokeDasharray={l.kind === "deadhead" ? "3 2" : undefined} />
              <line x1={a} x2={a} y1={G.route - 3} y2={G.route + 3} strokeWidth={1.5} />
              <line x1={b} x2={b} y1={G.route - 3} y2={G.route + 3} strokeWidth={1.5} />
            </g>
          );
        })}
          </>
        )}
        {/* On the Heat Map the words are plain ink: the colour belongs to the heat. */}
        {flights.map((l, i) => (
          <text key={`f${i}`} x={flightSpots[i].x} y={G.flightLanes[flightSpots[i].lane]} fontSize={font} fontWeight={500} fill={heat ? (l.kind === "flight" ? "var(--color-ink)" : "var(--color-ink-muted)") : LEG_COLOR[l.kind]}>
            {l.label}
          </text>
        ))}
        {stays.map((s, i) => (
          <text key={`t${i}`} x={citySpots[i].x} y={G.cityLanes[citySpots[i].lane]} fontSize={font} fontWeight={600} fill={heat ? "var(--color-ink)" : "var(--color-layover)"}>
            {s.city}
          </text>
        ))}
        {headers.map((h, i) => (
          <text key={`h${i}`} x={h.left} y={G.header} fontSize={headerFont}>
            <tspan fontWeight={600} fill="var(--color-ink)">
              {h.number}
            </tspan>
            {h.credit && <tspan fill="var(--color-ink-muted)"> {h.credit}</tspan>}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * The vacation on a Timeline or Heat Map strip, in its own minutes (`x`): a gold wash over it (`wash`: not on the Heat
 * Map, whose colours are heat), a gold bar along the top, the days it could slide to hatched either side of that bar,
 * and where the pack had it outlined when it's slid.
 */
function VacationLayer({ mark, x, height, wash, id }: { mark: LineVacationMark; x: (m: number) => number; height: number; wash: boolean; id: string }) {
  const hatch = `vh-${id}`;
  return (
    <g aria-hidden>
      <defs>
        <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-accent)" strokeWidth="1.5" />
        </pattern>
      </defs>
      {mark.pieces.map((p) => {
        const { before, after } = reachSpans(p);
        const slid = p.start !== p.awardedStart;
        return (
          <g key={p.id}>
            {wash && <rect x={x(p.start)} y={0} width={Math.max(1, x(p.end) - x(p.start))} height={height} fill="var(--color-accent)" opacity={0.13} />}
            {slid && <rect x={x(p.awardedStart) + 0.5} y={0.5} width={Math.max(1, x(p.awardedEnd) - x(p.awardedStart) - 1)} height={height - 1} rx={3} fill="none" stroke="var(--color-accent)" strokeOpacity={0.7} strokeDasharray="3 2" />}
            {[before, after].map((r, k) => (r ? <rect key={k} x={x(r[0])} y={0} width={Math.max(1, x(r[1]) - x(r[0]))} height={5} fill={`url(#${hatch})`} opacity={0.85} /> : null))}
            <rect x={x(p.start)} y={0} width={Math.max(1, x(p.end) - x(p.start))} height={3} rx={1.5} fill="var(--color-accent)">
              <title>{`Your vacation, ${p.days} days${slid ? ", slid" : ""}`}</title>
            </rect>
          </g>
        );
      })}
      {/* The free time a long trip needs beside the vacation, dotted on from its bar: a trip in it comes off too. */}
      {mark.freeWindows.map((w, i) => (
        <g key={`free${i}`} data-vacation-free>
          {wash && <rect x={x(w.start)} y={0} width={Math.max(1, x(w.end) - x(w.start))} height={height} fill="var(--color-accent)" opacity={0.07} />}
          <line x1={x(w.start)} x2={x(w.end)} y1={1.5} y2={1.5} stroke="var(--color-accent)" strokeWidth={3} strokeDasharray="2 2">
            <title>{w.title}</title>
          </line>
        </g>
      ))}
    </g>
  );
}

/** "VAC 7" where it has room on the strip: in the first free text row over the vacation, else left off (the gold says it). */
function vacationLabelSpot(p: { start: number; end: number; days: number }, x: (m: number) => number, rows: number[], taken: { x: number; w: number; y: number }[], charPx: number): { x: number; y: number; text: string } | null {
  const text = `VAC ${p.days}`;
  const w = text.length * charPx;
  const left = x(p.start);
  const right = x(p.end);
  if (right - left < w + 2) return null;
  const at = (left + right) / 2 - w / 2;
  for (const y of rows) if (!taken.some((t) => t.y === y && t.x < at + w + 3 && at < t.x + t.w + 3)) return { x: at, y, text };
  return null;
}

/**
 * The Timeline's rows, px from its top, as the month calendar stacks a day: the trips' numbers, their cards, two lanes of
 * routes over the flying, the flying in its duty band, the layover's own line under it, and two lanes of layover words.
 */
const CT = { height: 74, header: 9, card: 11, routeLanes: [31, 22], mid: 41, duty: 12, tick: 9, bar: 3, lane: 51, stayLanes: [63, 72] };

/**
 * The Timeline, drawn as the month calendar draws a day (`CalendarDayBars`), on the base's clock across the month: each
 * duty period a grey band, inside it each leg a bold line with tick ends — blue flown, magenta deadheaded, violet hotel
 * standby — and over it where the duty flies ("MEM-IND-DFW"; a stop only a deadhead touches in magenta). Each layover is a
 * green line of its own under the flying with its city and length under that ("PVG 28h"). Each trip is a card from
 * report to release with its number and credit over it, and the pack's "---" marks each day off. Words that don't fit
 * near their place say less (`routeTextVariants`), and are left off before they'd touch another or drift from it.
 */
function CalendarRoute({ columns, timeline, layout, vacation }: { columns: PackColumn[]; timeline: LineTimeline; layout: StripLayout; vacation?: LineVacationMark | null }) {
  const width = layout.daysPx;
  const total = columns.length * DAY_MIN;
  const x = (m: number) => (Math.min(Math.max(m, 0), total) / total) * width;
  const colPx = width / columns.length;
  const font = layout.font;
  const charPx = font * MONO_ADVANCE;
  const headerFont = font + 0.5;
  const maxShift = Math.max(10, colPx * 0.6);

  const trips = timeline.trips.map((t) => ({ left: x(t.start), right: Math.max(x(t.end), x(t.start) + 6), trip: t }));
  const duties = dutyRoutes(timeline);
  const routeWords = duties.map((d) => {
    const variants = routeTextVariants(d);
    return { d, variants, at: (x(d.flyStart) + x(d.flyEnd)) / 2, widths: variants.map((v) => routeText(v).length * charPx) };
  });
  const routeSpots = placeVariants(routeWords, CT.routeLanes.length, width, maxShift);
  const stayWords = timeline.stays.map((st) => {
    const variants = [`${st.city} ${Math.round(st.hours)}h`, st.city];
    return { st, variants, at: (x(st.start) + x(st.end)) / 2, widths: variants.map((v) => v.length * charPx) };
  });
  const staySpots = placeVariants(stayWords, CT.stayLanes.length, width, maxShift);

  // Each trip's number and credit from its card's left edge, the credit only where there's room before the next card.
  const fullWidth = (number: string, credit: string) => (number.length + 1 + credit.length) * headerFont * MONO_ADVANCE;
  const headerText = trips.map((c, i) => {
    const number = c.trip.number ?? "—";
    const credit = formatHoursValue(c.trip.creditHours);
    const next = trips[i + 1];
    return { number, credit: !next || c.left + 1 + fullWidth(number, credit) + 6 <= next.left ? credit : "" };
  });
  const headerWidths = headerText.map((h) => (h.credit ? fullWidth(h.number, h.credit) : h.number.length * headerFont * MONO_ADVANCE));
  const headerSpots = laneLabels(trips.map((c, i) => ({ at: c.left + 1 + headerWidths[i] / 2, width: headerWidths[i] })), 1, Infinity, 6);
  const offDays = timeline.offRuns.flatMap((r) => Array.from({ length: r.length }, (_, k) => r.day + k));
  const half = CT.duty / 2;
  const hatchId = useId().replace(/:/g, "");
  // The trips the vacation takes off: faded, still there, so the pilot sees what it gives up.
  const removed = new Set(vacation ? trips.flatMap((c, i) => (vacation.removedStarts.some((m) => m >= c.trip.start - 1 && m <= c.trip.end) ? [i] : [])) : []);
  const taken = [
    ...routeWords.flatMap((w, i) => (routeSpots[i] ? [{ x: routeSpots[i]!.x, w: w.widths[routeSpots[i]!.variant], y: CT.routeLanes[routeSpots[i]!.lane] }] : [])),
    ...stayWords.flatMap((w, i) => (staySpots[i] ? [{ x: staySpots[i]!.x, w: w.widths[staySpots[i]!.variant], y: CT.stayLanes[staySpots[i]!.lane] }] : [])),
  ];
  // Only in the layover rows at the foot: squeezed between route words, "VAC 7" read as one more stop.
  const vacLabels = (vacation?.pieces ?? []).flatMap((p) => {
    const spot = vacationLabelSpot(p, x, [CT.stayLanes[1], CT.stayLanes[0]], taken, charPx);
    if (spot) taken.push({ x: spot.x, w: spot.text.length * charPx, y: spot.y });
    return spot ? [spot] : [];
  });

  return (
    <div className="relative" style={{ height: CT.height, width: layout.mode === "fit" ? undefined : width }}>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }} aria-hidden>
        {columns.map((c, i) => (
          <div key={i} className={columnClass(c)} />
        ))}
      </div>
      <svg className="absolute inset-0 overflow-visible font-mono" width={width} height={CT.height} aria-hidden>
        {vacation && <VacationLayer mark={vacation} x={x} height={CT.height} wash id={hatchId} />}
        {offDays.map((d) => {
          const cx = (d + 0.5) * colPx;
          if (trips.some((c) => cx + 9 > c.left && cx - 9 < c.right)) return null;
          return (
            <text key={`o${d}`} x={cx} y={CT.mid + 3} textAnchor="middle" fontSize={font} fill="var(--color-ink-faint)">
              ---
            </text>
          );
        })}
        {trips.map((c, i) => (
          <rect key={`c${i}`} x={c.left} y={CT.card} width={c.right - c.left} height={CT.height - CT.card - 1} rx={5} fill="var(--color-surface-raised)" stroke="var(--color-border-strong)">
            <title>{`Trip ${c.trip.number ?? ""} · ${formatHoursValue(c.trip.creditHours)} credit · ${c.trip.days} days`}</title>
          </rect>
        ))}
        {/* Each duty period, report to release: the calendar's grey band around the flying. */}
        {timeline.duties.map((d, i) => (
          <rect key={`d${i}`} x={x(d.start)} y={CT.mid - half} width={Math.max(2, x(d.end) - x(d.start))} height={CT.duty} rx={2.5} fill="var(--color-trip-band)" />
        ))}
        {timeline.stays.map((st, i) => (
          <line key={`s${i}`} x1={x(st.start) + 1} x2={Math.max(x(st.start) + 2, x(st.end) - 1)} y1={CT.lane} y2={CT.lane} stroke="var(--color-layover)" strokeWidth={CT.bar} strokeLinecap="round">
            <title>{`Layover in ${st.city}, ${Math.round(st.hours)}h`}</title>
          </line>
        ))}
        {timeline.legs.map((l, i) => {
          const a = x(l.start);
          const b = Math.max(x(l.end), a + 2.5);
          const color = LEG_COLOR[l.kind];
          return (
            <g key={`l${i}`} stroke={color}>
              <title>{l.kind === "standby" ? `${l.flight === "ASBY" ? "Airport" : "Hotel"} standby at ${l.from}` : `${l.from}–${l.to}${l.kind === "deadhead" ? ", deadhead" : ""}`}</title>
              <line x1={a} x2={b} y1={CT.mid} y2={CT.mid} strokeWidth={CT.bar} strokeLinecap={l.kind === "standby" ? "round" : "butt"} />
              {l.kind !== "standby" && (
                <>
                  <line x1={a + 0.75} x2={a + 0.75} y1={CT.mid - CT.tick / 2} y2={CT.mid + CT.tick / 2} strokeWidth={1.5} />
                  <line x1={b - 0.75} x2={b - 0.75} y1={CT.mid - CT.tick / 2} y2={CT.mid + CT.tick / 2} strokeWidth={1.5} />
                </>
              )}
            </g>
          );
        })}
        {routeWords.map((w, i) => {
          const spot = routeSpots[i];
          if (!spot) return null;
          const cities = w.variants[spot.variant];
          return (
            <text key={`r${i}`} x={spot.x} y={CT.routeLanes[spot.lane]} fontSize={font} fontWeight={600}>
              {cities.map((c, k) => (
                <tspan key={k} fill={w.d.standby ? "var(--color-standby)" : c.deadhead ? "var(--color-deadhead)" : "var(--color-ink)"}>
                  {k > 0 ? "-" : ""}
                  {c.code}
                </tspan>
              ))}
            </text>
          );
        })}
        {stayWords.map((w, i) => {
          const spot = staySpots[i];
          if (!spot) return null;
          return (
            <text key={`t${i}`} x={spot.x} y={CT.stayLanes[spot.lane]} fontSize={font} fontWeight={600} fill="var(--color-layover)">
              {w.variants[spot.variant]}
            </text>
          );
        })}
        {headerText.map((h, i) => (
          <text key={`h${i}`} x={headerSpots[i].x} y={CT.header} fontSize={headerFont}>
            <tspan fontWeight={600} fill="var(--color-ink)">
              {h.number}
            </tspan>
            {h.credit && <tspan fill="var(--color-ink-muted)"> {h.credit}</tspan>}
          </text>
        ))}
        {/* Over a trip the vacation takes off: the card faded under the gold, its edge dashed. */}
        {trips.map((c, i) =>
          removed.has(i) ? (
            <rect key={`x${i}`} x={c.left} y={CT.card} width={c.right - c.left} height={CT.height - CT.card - 1} rx={5} fill="var(--color-surface)" fillOpacity={0.62} stroke="var(--color-accent)" strokeDasharray="3 2">
              <title>{`Trip ${c.trip.number ?? ""}: your vacation takes it off, paid from your bank`}</title>
            </rect>
          ) : null
        )}
        {vacLabels.map((l, i) => (
          <text key={`v${i}`} x={l.x} y={l.y} fontSize={font} fontWeight={700} fill="var(--color-accent)">
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * The Heat Map's band: each duty period and layover a block of its heat colour, as long as it lasts, a hairline of the
 * card between them so two the same colour still read as two. Pointing at one says why.
 */
function HeatBand({ pieces, x }: { pieces: HeatPiece[]; x: (m: number) => number }) {
  const [top, height] = HT.band;
  return (
    <g>
      {pieces.map((p, i) => {
        const a = x(p.start);
        const w = Math.max(1.5, x(p.end) - a);
        return (
          <rect key={i} x={a} y={top} width={w} height={height} fill={heatColor(p.heat)} stroke="var(--color-surface-raised)" strokeWidth={0.75} rx={1.5}>
            <title>{heatPieceText(p)}</title>
          </rect>
        );
      })}
    </g>
  );
}

interface BidPackStripProps {
  line: Line;
  /** The line's score; null where there's none to show yet (the interview), and `tag` marks the line instead. */
  score: number | null;
  /** In place of the score: a letter the line goes by ("A", "B"). */
  tag?: string;
  /** A violated dealbreaker holds the score down. */
  capped: boolean;
  columns: PackColumn[];
  view: StripView;
  layout: StripLayout;
  /** The drag handle, when the list is in the pilot's own order. */
  grip: ReactNode;
  open: boolean;
  onToggle: () => void;
  /**
   * The pilot swapped this line into its place: its score is still Line Select's own match, so a lower score can sit
   * above a higher one — the tag says that's the pilot's order, not a mistake.
   */
  placedByYou?: boolean;
  /** The pilot's top pick: its score is a location sign. */
  top?: boolean;
  /** Its place in the pilot's order, 1 first; absent where the list isn't ranked (the interview). */
  rank?: number | null;
  /** The pilot's vacation on this line (`lib/vacation-marks.ts`): drawn over its days, with how far it can slide. */
  vacation?: LineVacationMark | null;
}

export function BidPackStrip({ line, score, tag, capped, columns, view, layout, grip, open, onToggle, placedByYou = false, top = false, rank = null, vacation = null }: BidPackStripProps) {
  const heatSaid = view.kind === "heat" ? sharePercents(view.heat.share) : null;
  const label = `${rank ? `Number ${rank}, ` : ""}Line ${line.lineNumber}${score !== null ? `, Satisfaction Index ${formatIndex(score)}` : tag ? `, option ${tag}` : ""}${placedByYou ? ", placed here by you" : ""}${
    heatSaid && heatSaid.hot + heatSaid.mild + heatSaid.cold ? `, trips ${heatSaid.hot}% hot, ${heatSaid.mild}% mild, ${heatSaid.cold}% cold` : ""
  } — ${open ? "hide" : "show"} everything about it`;
  const k = layout.textScale;
  // On a phone the ring stops growing at 150% text: at 200% it took the room "LINE 2295" and the numbers needed.
  const ring = Math.round(layout.stacked ? 34 * Math.min(k, 1.5) : 38 * k);
  // The line's number and its numbers go under the ring where even one pair of their columns won't fit beside it (a
  // phone with its text at its largest): beside it, TAFB's and Credit's numbers ran off the card's edge, cut.
  const title = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {score !== null ? (
        <ScoreRing score={score} size={ring} capped={capped} top={top} index />
      ) : (
        tag && (
          <span aria-hidden className="flex shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-brand font-display text-base font-extrabold text-brand" style={{ width: Math.round(ring * 1.05), height: Math.round(ring * 0.78) }}>
            {tag}
          </span>
        )
      )}
      <div className="w-min min-w-0 grow">
        {/* On one line beside the days on a laptop; over the days on a phone it wraps as the pack view's does: kept on one
            line at 320px and 200% text, "#342 LINE 1316" ran off the card at "LINE 13". */}
        <div className={`flex items-center gap-1.5 font-mono text-xs font-semibold leading-[0.875rem] tracking-wide text-ink ${view.kind === "timeline" && !layout.stacked ? "whitespace-nowrap" : ""}`}>
          {rank !== null && (
            <span aria-hidden className="tabular-nums text-accent" data-rank={rank}>
              #{rank}
            </span>
          )}
          LINE {line.lineNumber}
          {placedByYou && (
            <span
              className="whitespace-nowrap rounded-[2px] border border-accent/50 px-1.5 py-px font-sans text-2xs font-semibold leading-[0.75rem] text-accent"
              title="You put this line here. Its score is still Line Select's own match, so it can sit above a line with a higher score."
            >
              Your order
            </span>
          )}
        </div>
        {/* The Timeline gives the days the room: its numbers are the pack view's to show. */}
        {view.kind === "pack" ? <Numbers line={line} /> : view.kind === "heat" ? <SpelledNumbers line={line} /> : null}
      </div>
      {view.kind === "heat" && <HeatShareLine share={view.heat.share} label="Trips" className="mt-1 basis-full" />}
    </div>
  );
  const drawn =
    view.kind === "pack" ? (
      <Days columns={columns} days={view.days} layout={layout} vacation={vacation} />
    ) : view.kind === "timeline" ? (
      <CalendarRoute columns={columns} timeline={view.timeline} layout={layout} vacation={vacation} />
    ) : (
      <RouteDays columns={columns} timeline={view.timeline} layout={layout} heat={view.heat} vacation={vacation} />
    );
  const chevron = <ChevronDownIcon className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />;

  if (layout.stacked || layout.mode === "scroll") {
    // The days scroll sideways under (a phone) or beside (a narrow laptop) the numbers, each strip with its own dates;
    // printed, they're under the numbers and fit the sheet.
    const scroller = (
      // Focusable, so a keyboard can scroll it too (arrow keys once it has focus).
      <div role="region" aria-label={`Line ${line.lineNumber}, day by day`} tabIndex={0} className="min-w-0 overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onToggle}>
        <div style={{ width: layout.mode === "fit" ? undefined : columns.length * SCROLL_COL }}>
          <DateRows columns={columns} layout={layout} />
          {drawn}
        </div>
      </div>
    );
    return layout.stacked ? (
      <div className="py-1.5" style={{ paddingLeft: PAD_X * k, paddingRight: PAD_X * k }}>
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
      <div className="flex items-stretch" style={{ paddingRight: PAD_X * k }}>
        <div className="flex shrink-0 items-center justify-center" style={{ width: (GRIP_W + PAD_X) * k }}>
          {grip}
        </div>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={label} className="flex shrink-0 items-center py-1.5 text-left" style={{ width: layout.leftW * k }}>
          {title}
        </button>
        <div className="min-w-0 flex-1 py-1">{scroller}</div>
        <button type="button" onClick={onToggle} aria-hidden tabIndex={-1} className="flex shrink-0 items-center justify-center" style={{ width: CHEVRON_W * k }}>
          {chevron}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-stretch" style={{ paddingRight: PAD_X * k }}>
      <div className="flex shrink-0 items-center justify-center" style={{ width: (GRIP_W + PAD_X) * k }}>
        {grip}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={label}
        className="grid min-w-0 flex-1 items-center py-1 text-left"
        style={{ gridTemplateColumns: `${layout.leftW * k}px minmax(0, 1fr) ${CHEVRON_W * k}px` }}
      >
        {title}
        {drawn}
        <span className="flex justify-center">{chevron}</span>
      </button>
    </div>
  );
}
