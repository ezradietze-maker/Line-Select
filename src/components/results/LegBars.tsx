"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dayBars, LABEL_CHAR_PX, layoverHours, stayLabelLeft, type BarLabel, type DayBars } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";
import { widthWatcher } from "@/lib/width-watcher";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { CityMark } from "@/types/preferences";

const DAY = 24 * 60;

/** The width an element is drawn at, kept up to date — one observer per grid or trip, not per day. */
export function useMeasuredWidth<T extends HTMLElement>(initial: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  const [watcher] = useState(() => widthWatcher(setWidth, initial));
  // After every render, not once: the element may only appear later (a list behind its loading screen).
  useEffect(() => watcher.follow(ref.current));
  useEffect(() => () => watcher.stop(), [watcher]);
  return [ref, width];
}

/** A trip's day row: wide enough for each leg's times over its ends. */
const SIZE = { track: 18, tick: 12, bar: 4, duty: 16, lane: 4, line: 12, labelPx: 40 };
/** How wide the hotel van is drawn at each end of a layover — a mark, not to scale: the pack doesn't print the ride's length. */
const GT_PX = 12;
/** The gap between the van and the layover line, so the two read as separate things. */
const GT_GAP = 3;

/** "15.8" hours → "15h48". */
export function stayHours(hours: number): string {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** How many lines of times and of cities a day needs, and whether it has a layover or rest-hotel line. */
export interface RowShape {
  timeRows: number;
  cityRows: number;
  lane: boolean;
}

const rowsOf = (labels: BarLabel[]) => (labels.some((l) => l.row === 1) ? 2 : labels.length ? 1 : 0);
const minGapAt = (widthPx: number) => (SIZE.labelPx * DAY) / Math.max(widthPx, 1);

/** One day's needs at this width — a trip draws every day at the most any of its days needs, so all stand the same height. */
export function rowShape(segments: TimelineSegment[], widthPx: number): RowShape {
  const bars = dayBars(segments, minGapAt(widthPx), undefined, Math.max(widthPx, 1));
  return { timeRows: rowsOf(bars.times), cityRows: rowsOf(bars.cities), lane: bars.stays.length > 0 || bars.rests.length > 0 };
}

export function largestShape(shapes: RowShape[]): RowShape {
  return {
    timeRows: Math.max(0, ...shapes.map((s) => s.timeRows)),
    cityRows: Math.max(0, ...shapes.map((s) => s.cityRows)),
    lane: shapes.some((s) => s.lane),
  };
}

/** Labels centered on their tick, nudged in at the day's edges so they stay inside it. */
function Labels({ labels, top, tone, width }: { labels: BarLabel[]; top: (row: 0 | 1) => number; tone: string; width: number }) {
  return (
    <>
      {labels.map((l, i) => {
        const half = (l.text.length * LABEL_CHAR_PX) / 2;
        const x = Math.min(Math.max((l.at / DAY) * width, half), width - half);
        return (
          <span
            key={i}
            className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-2xs leading-none ${l.deadhead ? "font-semibold text-deadhead" : tone}`}
            style={{ left: x, top: top(l.row), height: SIZE.line }}
          >
            {l.text}
          </span>
        );
      })}
    </>
  );
}

/** Where each label sits, in px, left to right — to keep a flight number off the cities beside it. */
function spans(labels: BarLabel[], row: 0 | 1, width: number): [number, number][] {
  return labels
    .filter((l) => l.row === row)
    .map((l) => {
      const half = (l.text.length * LABEL_CHAR_PX) / 2;
      const x = Math.min(Math.max((l.at / DAY) * width, half), width - half);
      return [x - half, x + half];
    });
}

/**
 * Each leg's flight number under the middle of its bar ("1875", "CAB" for a ride by road), and "HSTBY" under hotel
 * standby — wherever the bar is long enough to hold it clear of the cities at its ends. The rest are a tap away.
 */
function middleWords(bars: DayBars, width: number, taken: [number, number][]): { x: number; text: string; tone: string }[] {
  const x = (m: number) => (m / DAY) * width;
  const items = [
    ...bars.legs.map((l) => ({ start: l.start, end: l.end, text: l.cab ? "CAB" : l.flightNumber, tone: l.deadhead ? "text-deadhead" : "text-leg" })),
    ...bars.standby.map((s) => ({ start: s.start, end: s.end, text: "HSTBY", tone: "text-standby" })),
  ];
  const out: { x: number; text: string; tone: string }[] = [];
  for (const it of items) {
    const w = it.text.length * LABEL_CHAR_PX;
    const mid = (x(it.start) + x(it.end)) / 2;
    const span: [number, number] = [mid - w / 2 - 3, mid + w / 2 + 3];
    if (x(it.end) - x(it.start) < w + 4 || span[0] < 0 || span[1] > width) continue;
    if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue;
    taken.push(span);
    out.push({ x: mid, text: it.text, tone: it.tone });
  }
  return out;
}

/** How far a layover's words reach at the least before anything else may sit after them: "L/O SEA 16h". */
const stayWordsPx = (s: DayBars["stays"][number]) => `L/O ${s.city} ${Math.round(s.hours)}h`.length * LABEL_CHAR_PX;
const WORDS_GAP = 4;

/**
 * Where a layover's words begin, px: just past the hotel van, or further back toward the stay's own start when that
 * keeps "L/O SEA 16h" clear of the day's right edge (`stayLabelLeft`).
 */
function stayStart(s: DayBars["stays"][number], width: number): number {
  const x = (s.start / DAY) * width;
  const afterVan = s.runsIn ? x : Math.min(x, width - GT_PX) + GT_PX + GT_GAP + GT_PX + 2;
  return stayLabelLeft(afterVan, x, stayWordsPx(s), width);
}

/**
 * The words under the layover and crew-rest lines share one line, so each keeps clear of the others: a crew-rest hotel's
 * words centered on its line, the longest that fits ("Rest HTL IND 4h19", "Rest HTL IND", "HTL IND", or none — it's in
 * the day's detail); a layover's from its start up to the next words after it, cut off there. On a phone a hub turn's
 * rest and the layover beside it ran into each other.
 */
export function laneWords(bars: DayBars, width: number): { stays: ({ left: number; maxWidth: number } | null)[]; rests: ({ center: number; text: string } | null)[] } {
  const taken: [number, number][] = bars.stays.filter((s) => s.labeled).map((s) => {
    const left = stayStart(s, width);
    return [left, left + stayWordsPx(s)];
  });
  const rests = bars.rests.map((r) => {
    const mid = (((r.start + r.end) / 2) / DAY) * width;
    for (const text of [`Rest HTL ${r.city} ${stayHours(r.hours)}`, `Rest HTL ${r.city}`, `HTL ${r.city}`]) {
      const half = (text.length * LABEL_CHAR_PX) / 2;
      if (2 * half > width) continue;
      const center = Math.min(Math.max(mid, half), width - half);
      const span: [number, number] = [center - half - WORDS_GAP, center + half + WORDS_GAP];
      if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue;
      taken.push([center - half, center + half]);
      return { center, text };
    }
    return null;
  });
  const starts = [...rests.filter((r) => r !== null).map((r) => r.center - (r.text.length * LABEL_CHAR_PX) / 2), ...taken.map(([a]) => a)];
  const stays = bars.stays.map((s) => {
    if (!s.labeled) return null;
    const left = stayStart(s, width);
    const next = Math.min(width + WORDS_GAP, ...starts.filter((a) => a > left));
    return { left, maxWidth: Math.max(0, next - WORDS_GAP - left) };
  });
  return { stays, rests };
}

interface LegBarsProps {
  segments: TimelineSegment[];
  /** Width it's drawn at, measured by the parent (`useMeasuredWidth`) — decides where labels fit. */
  widthPx: number;
  /** The rows to keep, whether used or not — the most any day of the trip needs (`largestShape`). */
  shape: RowShape;
  /** Which hotel-stay pieces carry their words (`labeledStayPieces`); by default each stay's first piece. */
  stayLabeled?: (s: TimelineSegment) => boolean;
  cityPreferences?: Record<string, CityMark>;
  /** The words on a layover, in place of "L/O SEA 16h ♥" — handed the pilot's mark for the city to place. */
  formatStay?: (stay: { city: string; hours: number; hotel: string | null }, mark: ReactNode) => ReactNode;
}

/**
 * One day of a trip as the ex-pilot reads it, each thing in its own color: a bold line with ticks for each leg —
 * blue flown, magenta deadheaded — its times over its ends and its cities under them, its flight number under the
 * middle; hotel standby a violet bar; a grey band around the whole duty period (so a hub turn's wait reads as duty with
 * little flying). Under that, the layover: a green line from landing to the next pickup, the hotel van (GT) a cyan
 * mark at each end, the city, its length and the hotel on it; a crew-rest hotel at a hub a gold line of its own.
 */
export function LegBars({ segments, widthPx, shape, stayLabeled, cityPreferences, formatStay }: LegBarsProps) {
  const width = Math.max(widthPx, 1);
  const x = (m: number) => (m / DAY) * width;
  const bars = dayBars(segments, minGapAt(width), stayLabeled, width);
  const { timeRows, cityRows, lane } = shape;
  const trackTop = timeRows * SIZE.line + (timeRows ? 2 : 0);
  const mid = trackTop + SIZE.track / 2;
  const citiesTop = trackTop + SIZE.track + 2;
  const laneTop = citiesTop + Math.max(cityRows, 1) * SIZE.line + 3;
  const wordsTop = laneTop + SIZE.lane + 3;
  const height = lane ? wordsTop + SIZE.line : citiesTop + Math.max(cityRows, 1) * SIZE.line;
  const cityTop = (row: 0 | 1) => citiesTop + row * SIZE.line;
  const middle = middleWords(bars, width, spans(bars.cities, 0, width));
  const words = laneWords(bars, width);

  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      {[6, 12, 18].map((h) => (
        <span key={h} className="absolute w-px bg-ink/20" style={{ left: x(h * 60), top: trackTop + SIZE.track - 3, height: 3 }} />
      ))}
      {bars.duty.map((d, i) => (
        <span key={`d${i}`} className="absolute rounded-[3px] bg-trip-band" style={{ left: x(d.start) - 2, width: x(d.end) - x(d.start) + 4, top: mid - SIZE.duty / 2, height: SIZE.duty }} />
      ))}
      {bars.standby.map((d, i) => (
        <span key={`s${i}`} className="absolute rounded-full bg-standby" style={{ left: x(d.start), width: Math.max(2, x(d.end) - x(d.start)), top: mid - SIZE.bar / 2, height: SIZE.bar }} />
      ))}
      {bars.legs.map((l, i) => {
        const tone = l.deadhead ? "bg-deadhead" : "bg-leg";
        return (
          <span key={`l${i}`}>
            <span className={`absolute ${tone}`} style={{ left: x(l.start), width: Math.max(2, x(l.end) - x(l.start)), top: mid - SIZE.bar / 2, height: SIZE.bar }} />
            {l.from && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ left: x(l.start), top: mid - SIZE.tick / 2, height: SIZE.tick }} />}
            {l.to && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ left: x(l.end) - 2, top: mid - SIZE.tick / 2, height: SIZE.tick }} />}
          </span>
        );
      })}
      {timeRows > 0 && <Labels labels={bars.times} top={(row) => (timeRows === 2 && row === 0 ? SIZE.line : 0)} tone="text-ink-muted" width={width} />}
      <Labels labels={bars.cities} top={cityTop} tone="font-semibold text-ink" width={width} />
      {middle.map((m, i) => (
        <span key={`m${i}`} className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-2xs leading-none ${m.tone}`} style={{ left: m.x, top: cityTop(0), height: SIZE.line }}>
          {m.text}
        </span>
      ))}

      {lane &&
        bars.stays.map((s, i) => {
          // The van from the airport right after landing, then the hotel, then the van back at the pickup — three
          // pieces with a gap between each, so both rides show on every layover.
          const gtIn = s.runsIn ? null : Math.min(x(s.start), width - GT_PX);
          const gtOut = s.runsOn ? null : Math.min(x(s.end) + GT_GAP, width - GT_PX);
          const left = gtIn === null ? x(s.start) : gtIn + GT_PX + GT_GAP;
          const right = gtOut === null ? x(s.end) : gtOut - GT_GAP;
          return (
            <span key={`h${i}`}>
              <span className={`absolute bg-layover ${s.runsIn ? "" : "rounded-l-full"} ${s.runsOn ? "" : "rounded-r-full"}`} style={{ left, width: Math.max(2, right - left), top: laneTop, height: SIZE.lane }} />
              {gtIn !== null && <span className="absolute rounded-full bg-gt" style={{ left: gtIn, width: GT_PX, top: laneTop - 2, height: SIZE.lane + 4 }} title="GT in — airport to hotel" />}
              {gtOut !== null && <span className="absolute rounded-full bg-gt" style={{ left: gtOut, width: GT_PX, top: laneTop - 2, height: SIZE.lane + 4 }} title="GT out — hotel pickup" />}
              {s.labeled && words.stays[i] && (
                <span
                  className="absolute flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap font-mono text-2xs font-semibold leading-none text-layover"
                  style={{ left: words.stays[i]!.left, maxWidth: words.stays[i]!.maxWidth, top: wordsTop, height: SIZE.line }}
                >
                  {formatStay ? (
                    formatStay(s, <CityMarkGlyph mark={cityPreferences?.[s.city]} />)
                  ) : (
                    <>
                      L/O {s.city} {layoverHours(s.hours)}
                      <CityMarkGlyph mark={cityPreferences?.[s.city]} />
                    </>
                  )}
                </span>
              )}
            </span>
          );
        })}
      {lane &&
        bars.rests.map((r, i) => {
          const left = x(r.start);
          const w = Math.max(2, x(r.end) - left);
          const label = words.rests[i];
          return (
            <span key={`r${i}`}>
              <span className="absolute rounded-full bg-rest" style={{ left, width: w, top: laneTop, height: SIZE.lane }} />
              {label && (
                <span className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-2xs font-semibold leading-none text-rest" style={{ left: label.center, top: wordsTop, height: SIZE.line }}>
                  {label.text}
                </span>
              )}
            </span>
          );
        })}
    </div>
  );
}
