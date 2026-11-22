"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dayBars, LABEL_CHAR_PX, layoverHours, stayLabelLeft, type BarLabel, type DayBars } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";
import { widthWatcher } from "@/lib/width-watcher";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { HeatOf } from "@/components/results/HeatReasons";
import { HEAT_EDGE, heatColor, heatWash } from "@/lib/heat-scale";
import { heatPieceText } from "@/lib/line-heat";
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

/**
 * A trip's day row: wide enough for each leg's times over its ends. Its words are set in px (11px, the size
 * `LABEL_CHAR_PX` is measured at) like these rows: in rem, at 200% text the times ran over each other and the layover's
 * words were cut in half.
 */
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
function Labels({ labels, top, tone, width, deadheadTone = "font-semibold text-deadhead" }: { labels: BarLabel[]; top: (row: 0 | 1) => number; tone: string; width: number; deadheadTone?: string }) {
  return (
    <>
      {labels.map((l, i) => {
        const half = (l.text.length * LABEL_CHAR_PX) / 2;
        const x = Math.min(Math.max((l.at / DAY) * width, half), width - half);
        return (
          <span
            key={i}
            className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] leading-none ${l.deadhead ? deadheadTone : tone}`}
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
function middleWords(bars: DayBars, width: number, taken: [number, number][], plain = false): { x: number; text: string; tone: string }[] {
  const x = (m: number) => (m / DAY) * width;
  const items = [
    ...bars.legs.map((l) => ({ start: l.start, end: l.end, text: l.cab ? "CAB" : l.flightNumber, tone: plain ? (l.deadhead ? "text-ink-muted" : "text-ink") : l.deadhead ? "text-deadhead" : "text-leg" })),
    ...bars.standby.map((s) => ({ start: s.start, end: s.end, text: "HSTBY", tone: plain ? "text-ink" : "text-standby" })),
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
  /**
   * The Heat Map: each duty period's band and each layover's line in its heat colour (`lib/line-heat.ts`), everything
   * else in ink over them, so the colour is only ever heat.
   */
  heatOf?: HeatOf;
}

/** "+16h", "−17h": how far the local clock jumps crossing the date line. */
export const jumpLabel = (minutes: number) => `${minutes > 0 ? "+" : "−"}${Math.round(Math.abs(minutes) / 60)}h`;

/**
 * A squiggle along a line, from x0 to x1 at height y — the ex-pilot's mark for hours the clock jumps rather than flies,
 * the same as the month calendar's. Anchored at `anchor`, so one running on past midnight carries on into the next row
 * in step.
 */
export function squiggle(x0: number, x1: number, y: number, anchor: number): string {
  const step = 3;
  const amp = 2.5;
  const points: string[] = [`${x0},${y}`];
  for (let k = Math.ceil((x0 - anchor - step / 2) / step); anchor + step / 2 + k * step < x1; k++) {
    const px = anchor + step / 2 + k * step;
    if (px > x0) points.push(`${px},${y + (k % 2 === 0 ? -amp : amp)}`);
  }
  points.push(`${x1},${y}`);
  return points.join(" ");
}

/** Where one row of a day sits: its times, the track the flying is on and its middle, the cities, the layover line and its words. */
interface Frame {
  timeRows: number;
  cityRows: number;
  lane: boolean;
  top: number;
  trackTop: number;
  mid: number;
  citiesTop: number;
  laneTop: number;
  wordsTop: number;
  bottom: number;
}

function frameAt(top: number, { timeRows, cityRows, lane }: RowShape): Frame {
  const trackTop = top + timeRows * SIZE.line + (timeRows ? 2 : 0);
  const citiesTop = trackTop + SIZE.track + 2;
  const laneTop = citiesTop + Math.max(cityRows, 1) * SIZE.line + 3;
  const wordsTop = laneTop + SIZE.lane + 3;
  const bottom = lane ? wordsTop + SIZE.line : citiesTop + Math.max(cityRows, 1) * SIZE.line;
  return { timeRows, cityRows, lane, top, trackTop, mid: trackTop + SIZE.track / 2, citiesTop, laneTop, wordsTop, bottom };
}

/**
 * One day of a trip as the ex-pilot reads it, each thing in its own color: a bold line with ticks for each leg —
 * blue flown, magenta deadheaded — its times over its ends and its cities under them, its flight number under the
 * middle; hotel standby a violet bar; a grey band around the whole duty period (so a hub turn's wait reads as duty with
 * little flying). Under that, the layover: a green line from landing to the next pickup, the hotel van (GT) a cyan
 * mark at each end, the city, its length and the hotel on it; a crew-rest hotel at a hub a gold line of its own.
 *
 * Across the date line, west it's drawn the month calendar's way (`CalendarDayBars`): the flight bold for its real
 * length and the hours the clock jumps a squiggle, "+16h" over it. East, the trip's rows run in the order they're lived
 * (`buildLivedDays`): the flight is cut at the line with a zigzag and carries on from a zigzag on the next row — the
 * same date again, "−17h" over it — so nothing runs back up the page. On Zulu's clock nothing jumps: the flight at its
 * real length, a zigzag where it crosses.
 */
export function LegBars({ segments, widthPx, shape, stayLabeled, cityPreferences, formatStay, heatOf }: LegBarsProps) {
  /** On the Heat Map a flight (or hotel standby) is drawn in its duty period's heat, finely edged, over the band's wash of it. */
  const heatPaint = (seg: TimelineSegment | undefined) => {
    const heat = heatOf?.(seg, "duty");
    return heat ? { background: heatColor(heat.heat), boxShadow: HEAT_EDGE } : undefined;
  };
  const width = Math.max(widthPx, 1);
  const x = (m: number) => (m / DAY) * width;
  const bars = dayBars(segments, minGapAt(width), stayLabeled, width);
  const first = frameAt(0, shape);
  const height = first.bottom;

  const row = (b: DayBars, f: Frame, key: string) => {
    const cityTop = (r: 0 | 1) => f.citiesTop + r * SIZE.line;
    const middle = middleWords(b, width, spans(b.cities, 0, width), !!heatOf);
    const words = laneWords(b, width);
    const mid = f.mid;
    // The time labels' spans, so the date line's "+16h" over the flying keeps clear of them.
    const taken: [number, number][] = [...spans(b.times, 0, width), ...spans(b.times, 1, width)];
    /** "+16h" / "−17h" over the flying where it fits clear of the times; else it's in the day's column and its detail. */
    const jumpWords = (at: number, minutes: number, ink: string) => {
      if (f.timeRows === 0) return null;
      const text = jumpLabel(minutes);
      const half = (text.length * LABEL_CHAR_PX) / 2;
      const center = Math.min(Math.max(at, half), width - half);
      if (taken.some(([a, c]) => center - half - 6 < c && a < center + half + 6)) return null;
      taken.push([center - half, center + half]);
      return (
        <span className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-semibold leading-none ${ink}`} style={{ left: center, top: f.top + (f.timeRows === 2 ? SIZE.line : 0), height: SIZE.line }}>
          {text}
        </span>
      );
    };

    return (
      <span key={key}>
        {[6, 12, 18].map((h) => (
          <span key={h} className="absolute w-px bg-ink/20" style={{ left: x(h * 60), top: f.trackTop + SIZE.track - 3, height: 3 }} />
        ))}
        {b.duty.map((d, i) => {
          const heat = heatOf?.(d.seg, "duty");
          return (
            <span
              key={`d${i}`}
              className={`absolute rounded-[3px] ${heat ? "" : "bg-trip-band"}`}
              style={{ left: x(d.start) - 2, width: x(d.end) - x(d.start) + 4, top: mid - SIZE.duty / 2, height: SIZE.duty, ...(heat ? { background: heatWash(heat.heat) } : {}) }}
              title={heat ? heatPieceText(heat) : undefined}
            />
          );
        })}
        {b.standby.map((d, i) => (
          <span key={`s${i}`} className={`absolute rounded-full ${heatPaint(d.seg) ? "" : "bg-standby"}`} style={{ left: x(d.start), width: Math.max(2, x(d.end) - x(d.start)), top: mid - SIZE.bar / 2, height: SIZE.bar, ...heatPaint(d.seg) }} />
        ))}
        {b.legs.map((l, i) => {
          // On the Heat Map, the colour of its duty period's heat (a deadhead a little fainter); else blue flown, magenta deadheaded.
          const paint = heatPaint(l.seg);
          const flown = paint ? { ...paint, ...(l.deadhead ? { opacity: 0.7 } : {}) } : undefined;
          const tone = paint ? "" : l.deadhead ? "bg-deadhead" : "bg-leg";
          // A date-line flight keeps its own leg color, as on the month calendar: its shape says the rest.
          const ink = paint ? "text-ink" : l.deadhead ? "text-deadhead" : "text-leg";
          const ticks = (
            <>
              {l.from && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ ...flown, left: x(l.start), top: mid - SIZE.tick / 2, height: SIZE.tick }} />}
              {l.to && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ ...flown, left: x(l.end) - 2, top: mid - SIZE.tick / 2, height: SIZE.tick }} />}
            </>
          );
          const bar = (left: number, right: number) => <span className={`absolute ${tone}`} style={{ ...flown, left, width: Math.max(2, right - left), top: mid - SIZE.bar / 2, height: SIZE.bar }} />;
          if (l.rewind) {
            // East across the date line: the flight is cut where it crosses — a zigzag, the line — and carries on from that
            // same mark on the next row, the date lived again on the arrival side's clock, "−17h" over it.
            const left = x(l.start);
            const right = x(l.end);
            const at = l.rewind === "out" ? right : left;
            const zig = Math.min(Math.max(at, 4), width - 4);
            return (
              <span key={`l${i}`} title={`Crosses the date line eastbound${l.clockJump != null ? ` — the local clock goes back ${jumpLabel(l.clockJump).slice(1)}: ${l.rewind === "out" ? "the flight carries on in the next row, the same date again" : "the same date again, on the arrival side's clock"}` : ""}`}>
                {bar(left, right)}
                {ticks}
                <svg className={`absolute left-0 top-0 overflow-visible ${ink}`} width={width} height={height} aria-hidden>
                  <polyline points={`${zig - 4},${mid - 7} ${zig - 1},${mid + 7} ${zig + 1},${mid - 7} ${zig + 4},${mid + 7}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
                </svg>
                {l.rewind === "in" && l.clockJump != null && (jumpWords(at + 16, l.clockJump, ink) ?? jumpWords(at - 16, l.clockJump, ink))}
              </span>
            );
          }
          if (l.jump) {
            // West across the date line: the flight bold for its real length, the clock's jump a squiggle.
            const left = x(l.start);
            const right = x(l.end);
            const j0 = l.jump.start <= 0 ? 0 : x(l.jump.start);
            const j1 = l.jump.end >= DAY ? width : x(l.jump.end);
            return (
              <span key={`l${i}`} title={`Crosses the date line westbound — the flight in bold, the local clock's ${jumpLabel(l.jump.minutes)} jump as the squiggle`}>
                {j0 > left && bar(left, j0)}
                {right > j1 && bar(j1, right)}
                <svg className={`absolute left-0 top-0 overflow-visible ${ink}`} width={width} height={height} aria-hidden>
                  <polyline points={squiggle(j0, j1, mid, l.jump.end >= DAY ? j1 : j0)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                </svg>
                {ticks}
                {j1 - j0 > 26 && jumpWords((j0 + j1) / 2, l.jump.minutes, ink)}
              </span>
            );
          }
          if (l.mark) {
            // Zulu: nothing jumps — the flight at its real length, a zigzag where it crosses, and how far the local clock jumps.
            const at = x(l.mark.at);
            return (
              <span key={`l${i}`} title={`Crosses the date line ${l.dateLine === "east" ? "eastbound" : "westbound"} — the local clock jumps ${jumpLabel(l.mark.jumpMinutes)}`}>
                {bar(x(l.start), x(l.end))}
                {ticks}
                <svg className={`absolute left-0 top-0 overflow-visible ${ink}`} width={width} height={height} aria-hidden>
                  <polyline points={`${at - 4},${mid - 6} ${at - 1},${mid + 6} ${at + 1},${mid - 6} ${at + 4},${mid + 6}`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                </svg>
                {jumpWords(at, l.mark.jumpMinutes, ink)}
              </span>
            );
          }
          return (
            <span key={`l${i}`}>
              {bar(x(l.start), x(l.end))}
              {ticks}
            </span>
          );
        })}
        {f.timeRows > 0 && <Labels labels={b.times} top={(r) => f.top + (f.timeRows === 2 && r === 0 ? SIZE.line : 0)} tone="text-ink-muted" width={width} deadheadTone={heatOf ? "text-ink-muted" : undefined} />}
        <Labels labels={b.cities} top={cityTop} tone="font-semibold text-ink" width={width} deadheadTone={heatOf ? "font-semibold text-ink-muted" : undefined} />
        {middle.map((m, i) => (
          <span key={`m${i}`} className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] leading-none ${m.tone}`} style={{ left: m.x, top: cityTop(0), height: SIZE.line }}>
            {m.text}
          </span>
        ))}

        {f.lane &&
          b.stays.map((st, i) => {
            // The van from the airport right after landing, then the hotel, then the van back at the pickup — three
            // pieces with a gap between each, so both rides show on every layover.
            const gtIn = st.runsIn ? null : Math.min(x(st.start), width - GT_PX);
            const gtOut = st.runsOn ? null : Math.min(x(st.end) + GT_GAP, width - GT_PX);
            const left = gtIn === null ? x(st.start) : gtIn + GT_PX + GT_GAP;
            const right = gtOut === null ? x(st.end) : gtOut - GT_GAP;
            const heat = heatOf?.(st.seg, "layover");
            const gt = heatOf ? "bg-ink-faint" : "bg-gt";
            return (
              <span key={`h${i}`}>
                <span
                  className={`absolute ${heat ? "" : "bg-layover"} ${st.runsIn ? "" : "rounded-l-full"} ${st.runsOn ? "" : "rounded-r-full"}`}
                  style={heat ? { left, width: Math.max(2, right - left), top: f.laneTop - 1, height: SIZE.lane + 2, background: heatColor(heat.heat) } : { left, width: Math.max(2, right - left), top: f.laneTop, height: SIZE.lane }}
                  title={heat ? heatPieceText(heat) : undefined}
                />
                {gtIn !== null && <span className={`absolute rounded-full ${gt}`} style={{ left: gtIn, width: GT_PX, top: f.laneTop - 2, height: SIZE.lane + 4 }} title="GT in — airport to hotel" />}
                {gtOut !== null && <span className={`absolute rounded-full ${gt}`} style={{ left: gtOut, width: GT_PX, top: f.laneTop - 2, height: SIZE.lane + 4 }} title="GT out — hotel pickup" />}
                {st.labeled && words.stays[i] && (
                  <span
                    className={`absolute flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap font-mono text-[11px] font-semibold leading-none ${heatOf ? "text-ink" : "text-layover"}`}
                    style={{ left: words.stays[i]!.left, maxWidth: words.stays[i]!.maxWidth, top: f.wordsTop, height: SIZE.line }}
                  >
                    {formatStay ? (
                      formatStay(st, <CityMarkGlyph mark={cityPreferences?.[st.city]} />)
                    ) : (
                      <>
                        L/O {st.city} {layoverHours(st.hours)}
                        <CityMarkGlyph mark={cityPreferences?.[st.city]} />
                      </>
                    )}
                  </span>
                )}
              </span>
            );
          })}
        {f.lane &&
          b.rests.map((r, i) => {
            const left = x(r.start);
            const w = Math.max(2, x(r.end) - left);
            const label = words.rests[i];
            return (
              <span key={`r${i}`}>
                <span className={`absolute rounded-full ${heatOf ? "bg-ink-faint" : "bg-rest"}`} style={{ left, width: w, top: f.laneTop, height: SIZE.lane }} />
                {label && (
                  <span className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-semibold leading-none ${heatOf ? "text-ink-muted" : "text-rest"}`} style={{ left: label.center, top: f.wordsTop, height: SIZE.line }}>
                    {label.text}
                  </span>
                )}
              </span>
            );
          })}
      </span>
    );
  };

  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      {row(bars, first, "first")}
    </div>
  );
}
