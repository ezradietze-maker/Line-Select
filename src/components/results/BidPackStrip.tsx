"use client";

import { useId, type ReactNode } from "react";
import { ScoreRing } from "@/components/results/ScoreRing";
import { ChevronDownIcon } from "@/components/ui/icons";
import { PillHighlight } from "@/components/ui/PillHighlight";
import type { PackColumn, PackDay, PackToken } from "@/lib/bidpack-row";
import { PACK_TOKENS_PER_DAY } from "@/lib/bidpack-row";
import { formatHoursValue } from "@/lib/interview-config";
import { laneLabels, routesOf } from "@/lib/line-route";
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
 * - "timeline": everything the pack prints for the line, organised by trip on the month's timeline (`lib/line-route.ts`):
 *   each trip one card from report to release with its number and credit, its flights and layovers inside as one route
 *   — every flight number over its own leg, every city under its own layover — the pack's "---" on each day off, and
 *   the pack's eight numbers in words.
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
export function StripKey({ view, hint = "Tap a line for everything about it.", className = "" }: { view: StripViewMode; hint?: string; className?: string }) {
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
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted ${className}`} role="group" aria-label="How to read a line's strip">
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
            <svg aria-hidden width="30" height="8" className="overflow-visible">
              <line x1="1" x2="29" y1="4" y2="4" stroke="var(--color-leg)" strokeWidth="2" />
              <line x1="1" x2="1" y1="1" y2="7" stroke="var(--color-leg)" strokeWidth="1.5" />
              <line x1="29" x2="29" y1="1" y2="7" stroke="var(--color-leg)" strokeWidth="1.5" />
            </svg>,
            "flight, takeoff to landing, its number over it"
          )}
          {item(
            <svg aria-hidden width="20" height="8">
              <line x1="0" x2="20" y1="4" y2="4" stroke="var(--color-deadhead)" strokeWidth="2" strokeDasharray="3 2" />
            </svg>,
            "D/H, deadhead"
          )}
          {item(<span aria-hidden className="inline-block h-1 w-6 rounded-full bg-layover/85" />, "layover, as long as it lasts, its city under it")}
          {item(<span className="rounded-[4px] border border-border-strong bg-surface-raised px-1">{trip}</span>, "trip, report to the end of its last duty period, and its credit")}
          {item(word("---", "text-ink-faint"), "day off")}
        </>
      )}
      <span>{hint}</span>
    </div>
  );
}

/** The pilot's switch between the two strips. */
export function StripViewToggle({ view, onChange }: { view: StripViewMode; onChange: (view: StripViewMode) => void }) {
  const group = useId();
  const option = (value: StripViewMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === value}
      onClick={() => onChange(value)}
      className={`relative rounded-full px-3 py-1 text-xs font-medium transition-colors duration-300 ${view === value ? "text-canvas" : "text-ink-muted hover:text-ink"}`}
    >
      {view === value && <PillHighlight group={group} className="absolute inset-0 rounded-full bg-ink" />}
      <span className="relative z-10">{label}</span>
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

/** The shared date header over a list of strips laid out to fit — kept in view while the list scrolls, unless `sticky` is off. */
export function BidPackHeader({ columns, layout, label = "Line · score", sticky = true }: { columns: PackColumn[]; layout: StripLayout; label?: string; sticky?: boolean }) {
  if (layout.mode !== "fit") return null;
  return (
    <div className={`${sticky ? "sticky top-0 z-20" : ""} -mx-px rounded-t-lg border border-hairline bg-canvas/95 backdrop-blur print:static`} style={{ paddingLeft: PAD_X + GRIP_W, paddingRight: PAD_X }}>
      <div className="grid" style={{ gridTemplateColumns: `${LEFT_W}px minmax(0, 1fr) ${CHEVRON_W}px` }}>
        <div className="self-end pb-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-faint">{label}</div>
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

/** Which strip, and what it draws. */
export type StripView = { kind: "pack"; days: PackDay[] } | { kind: "timeline"; timeline: LineTimeline };

/** The same eight numbers the pack prints left of a line, in words a pilot reads at a glance. */
function SpelledNumbers({ line }: { line: Line }) {
  const hm = formatHoursValue;
  const rows: [string, string, string, string][] = [
    ["Credit", hm(line.totalCreditHours), "TAFB", hm(line.totalTafbHours)],
    ["Block", line.totalBlockHours !== undefined ? hm(line.totalBlockHours) : "—", "Duties", String(line.totalDutyPeriods ?? "—")],
    ["C/O cr", hm(line.carryOverCreditHours ?? 0), "Landings", String(line.totalLandings)],
    ["C/O blk", hm(line.carryOverBlockHours ?? 0), "Days off", String(line.daysOff)],
  ];
  return (
    <div className="grid grid-cols-[auto_auto_auto_auto] items-baseline gap-x-[5px] text-[9.5px] leading-[12px]">
      {rows.map(([a, av, b, bv], i) => (
        <div key={i} className="contents">
          <span className="text-ink-muted">{a}</span>
          <span className="text-right font-mono tabular-nums text-ink">{av}</span>
          <span className="pl-1 text-ink-muted">{b}</span>
          <span className="text-right font-mono tabular-nums text-ink">{bv}</span>
        </div>
      ))}
    </div>
  );
}

const DAY_MIN = 24 * 60;
/** The Timeline strip's rows, px from its top: the trips' numbers, their cards, the route, its flight-number lanes over it and city lanes under it. */
const RT = { height: 71, header: 9, card: 11, route: 46, flightLanes: [41, 31, 21], cityLanes: [57, 66] };
const LEG_COLOR: Record<TimelineLeg["kind"], string> = {
  flight: "var(--color-leg)",
  deadhead: "var(--color-deadhead)",
  standby: "var(--color-standby)",
};
/** Plex Mono's advance, per px of font size: how wide a word is drawn. */
const MONO_ADVANCE = 0.6;

/**
 * The Timeline: every word the pack prints for the line, organised by trip, on the base's clock. Each trip is one card
 * from report to release with its number and credit over it; inside, its flights and layovers run as one route — each
 * flight a line with tick ends from takeoff to landing and its number over it (a deadhead run dashed, "D/H"), each
 * layover a green stretch as long as it lasts with its city under it, each wait at an airport between legs a thin line.
 * The pack's "---" on each day off. Words sit in lanes and never touch (`laneLabels`).
 */
function RouteDays({ columns, timeline, layout }: { columns: PackColumn[]; timeline: LineTimeline; layout: StripLayout }) {
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
  const flightSpots = laneLabels(flights, RT.flightLanes.length, width);
  const stays = routes.flatMap((r) => r.stays.map((s) => ({ ...s, at: (x(s.start) + x(s.end)) / 2, width: s.city.length * charPx })));
  const citySpots = laneLabels(stays, RT.cityLanes.length, width);
  // Each trip's number and its credit, always both, from its card's left edge: a crowded one moves along rather than covering the one before.
  const headerText = cards.map((c) => ({ number: c.trip.number ?? "—", credit: formatHoursValue(c.trip.creditHours) }));
  const headerWidths = headerText.map((h) => (h.number.length + 1 + h.credit.length) * headerFont * MONO_ADVANCE);
  const headerSpots = laneLabels(cards.map((c, i) => ({ at: c.left + 1 + headerWidths[i] / 2, width: headerWidths[i] })), 1, Infinity, 6);
  const headers = headerText.map((h, i) => ({ ...h, left: headerSpots[i].x }));
  const offDays = timeline.offRuns.flatMap((r) => Array.from({ length: r.length }, (_, k) => r.day + k));

  return (
    <div className="relative" style={{ height: RT.height, width: layout.mode === "fit" ? undefined : width }}>
      {/* The days behind: the pack's week lines, weekends shaded, next month faint. */}
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: gridColumns(columns.length, layout) }} aria-hidden>
        {columns.map((c, i) => (
          <div key={i} className={columnClass(c)} />
        ))}
      </div>
      <svg className="absolute inset-0 overflow-visible font-mono" width={width} height={RT.height} aria-hidden>
        {offDays.map((d) => {
          const cx = (d + 0.5) * colPx;
          if (cards.some((c) => cx + 9 > c.left && cx - 9 < c.right)) return null;
          return (
            <text key={`o${d}`} x={cx} y={RT.route + 3} textAnchor="middle" fontSize={font} fill="var(--color-ink-faint)">
              ---
            </text>
          );
        })}
        {cards.map((c, i) => (
          <rect key={`c${i}`} x={c.left} y={RT.card} width={c.right - c.left} height={RT.height - RT.card - 1} rx={5} fill="var(--color-surface-raised)" stroke="var(--color-border-strong)">
            <title>{`Trip ${c.trip.number ?? ""} · ${formatHoursValue(c.trip.creditHours)} credit · ${c.trip.days} days`}</title>
          </rect>
        ))}
        {routes.flatMap((r, i) =>
          r.waits.map((w, k) => <line key={`w${i}-${k}`} x1={x(w.start)} x2={x(w.end)} y1={RT.route} y2={RT.route} stroke="var(--color-ink-faint)" strokeWidth={1} />)
        )}
        {stays.map((s, i) => (
          <line key={`s${i}`} x1={x(s.start) + 1} x2={Math.max(x(s.start) + 2, x(s.end) - 1)} y1={RT.route} y2={RT.route} stroke="var(--color-layover)" strokeWidth={4} strokeLinecap="round" opacity={0.85}>
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
              <line x1={a} x2={b} y1={RT.route} y2={RT.route} strokeWidth={2} strokeDasharray={l.kind === "deadhead" ? "3 2" : undefined} />
              <line x1={a} x2={a} y1={RT.route - 3} y2={RT.route + 3} strokeWidth={1.5} />
              <line x1={b} x2={b} y1={RT.route - 3} y2={RT.route + 3} strokeWidth={1.5} />
            </g>
          );
        })}
        {flights.map((l, i) => (
          <text key={`f${i}`} x={flightSpots[i].x} y={RT.flightLanes[flightSpots[i].lane]} fontSize={font} fontWeight={500} fill={LEG_COLOR[l.kind]}>
            {l.label}
          </text>
        ))}
        {stays.map((s, i) => (
          <text key={`t${i}`} x={citySpots[i].x} y={RT.cityLanes[citySpots[i].lane]} fontSize={font} fontWeight={600} fill="var(--color-layover)">
            {s.city}
          </text>
        ))}
        {headers.map((h, i) => (
          <text key={`h${i}`} x={h.left} y={RT.header} fontSize={headerFont}>
            <tspan fontWeight={600} fill="var(--color-ink)">
              {h.number}
            </tspan>
            <tspan fill="var(--color-ink-muted)"> {h.credit}</tspan>
          </text>
        ))}
      </svg>
    </div>
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
}

export function BidPackStrip({ line, score, tag, capped, columns, view, layout, grip, open, onToggle, placedByYou = false }: BidPackStripProps) {
  const label = `Line ${line.lineNumber}${score !== null ? `, score ${Math.round(score)}` : tag ? `, option ${tag}` : ""}${placedByYou ? ", placed here by you" : ""} — ${open ? "hide" : "show"} everything about it`;
  const ring = layout.stacked ? 34 : 38;
  const title = (
    <div className="flex min-w-0 items-center gap-2">
      {score !== null ? (
        <ScoreRing score={score} size={ring} capped={capped} />
      ) : (
        tag && (
          <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full border-2 border-brand font-display text-base font-semibold text-brand" style={{ width: ring, height: ring }}>
            {tag}
          </span>
        )
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold leading-[14px] tracking-wide text-ink">
          LINE {line.lineNumber}
          {placedByYou && (
            <span
              className="whitespace-nowrap rounded-full border border-accent/40 bg-accent-soft px-1.5 py-px text-[9px] font-semibold uppercase leading-[12px] tracking-[0.08em] text-accent"
              title="You put this line here. Its score is still Line Select's own match, so it can sit above a line with a higher score."
            >
              Your order
            </span>
          )}
        </div>
        {view.kind === "pack" ? <Numbers line={line} /> : <SpelledNumbers line={line} />}
      </div>
    </div>
  );
  const drawn =
    view.kind === "pack" ? <Days columns={columns} days={view.days} layout={layout} /> : <RouteDays columns={columns} timeline={view.timeline} layout={layout} />;
  const chevron = <ChevronDownIcon className={`h-4 w-4 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />;

  if (layout.stacked || layout.mode === "scroll") {
    // The days scroll sideways under (a phone) or beside (a narrow laptop) the numbers, each strip with its own dates.
    const scroller = (
      // Focusable, so a keyboard can scroll it too (arrow keys once it has focus).
      <div role="region" aria-label={`Line ${line.lineNumber}, day by day`} tabIndex={0} className="min-w-0 overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onToggle}>
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
