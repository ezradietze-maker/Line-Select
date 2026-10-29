"use client";

import type { ReactNode } from "react";
import { dayBars, fitLayoverLabel, LABEL_CHAR_PX, layoverHours, type BarLabel } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { CityMark } from "@/types/preferences";

const DAY = 24 * 60;

/** A month-calendar day: room for three-letter cities, not for times. */
const SIZE = { top: 11, track: 10, tick: 9, bar: 3, duty: 6, lane: 3, line: 10, labelPx: 22 };

/** Room the pilot's mark for a city (♥, ✕) takes after its name. */
const MARK_PX = 10;

/**
 * Labels centered on their tick — free to run a little past the day's edges into the gap and the next day, as the
 * ex-pilot let his codes run on paper, but no further.
 */
function Labels({ labels, top, line, tone, width, bleed }: { labels: BarLabel[]; top: (row: 0 | 1) => number; line: number; tone: string; width: number; bleed: number }) {
  return (
    <>
      {labels.map((l, i) => {
        const half = (l.text.length * LABEL_CHAR_PX) / 2;
        const x = Math.min(Math.max((l.at / DAY) * width, half - bleed), width + bleed - half);
        return (
          <span
            key={i}
            className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-semibold leading-none ${l.deadhead ? "text-deadhead" : tone}`}
            style={{ left: x, top: top(l.row), height: line }}
          >
            {l.text}
          </span>
        );
      })}
    </>
  );
}

interface CalendarDayBarsProps {
  segments: TimelineSegment[];
  /** Width it's drawn at, measured by the grid (`useMeasuredWidth`) — decides where labels fit. */
  widthPx: number;
  /** Which layover pieces carry their words (`labeledStayPieces`); by default each layover's first piece. */
  stayLabeled?: (s: TimelineSegment) => boolean;
  cityPreferences?: Record<string, CityMark>;
  /** Layover cities abroad — their name is underlined with dots, as everywhere else. */
  internationalCities?: ReadonlySet<string>;
  /** Under a width this narrow, the cities don't fit: bars only. */
  minLabelWidth?: number;
  /**
   * The day's own line over its picture — the report — always kept, so every day's bars sit at the same height and a
   * flight past midnight meets itself in the next day. A layover's words too long for their piece of the day move up
   * into it when it's free — the ex-pilot's "move L/O to top if necessary for space".
   */
  top?: ReactNode;
  /** How far a line at midnight runs past the day's edge, to meet the next day's across the gap between them. */
  bleed?: number;
}

/** A layover's words: "L/O" (when there's room for it), the city, its length to the hour, and how the pilot feels about it. */
function LayoverWords({ city, hours, prefix, withHours, international, mark }: { city: string; hours: number; prefix: boolean; withHours: boolean; international: boolean; mark: ReactNode }) {
  return (
    <>
      {prefix && <span className="font-normal">L/O </span>}
      <span className={international ? "underline decoration-dotted underline-offset-2" : ""}>{city}</span>
      {withHours && <span className="font-normal"> {layoverHours(hours)}</span>}
      {mark}
    </>
  );
}

/**
 * One day of a line's month calendar as the ex-pilot sketched it over his own line (see `lib/leg-bars.ts`), each
 * thing in its own color so it reads at a glance: a bold line with ticks for each leg — blue flown, magenta
 * deadheaded — the cities over its ends, a faint band under the time on duty (so a hub turn's wait reads as duty with
 * little flying), and each layover a green line of its own under the flying with "L/O OAK 28h" on it. The trip view's
 * rows keep their own picture (`LegBars`).
 */
export function CalendarDayBars({ segments, widthPx, stayLabeled, cityPreferences, internationalCities, minLabelWidth = 60, top, bleed = 0 }: CalendarDayBarsProps) {
  const size = SIZE;
  const width = Math.max(widthPx, 1);
  const x = (m: number) => (m / DAY) * width;
  const showCities = width >= minLabelWidth;
  const minGap = (size.labelPx * DAY) / width;
  const bars = dayBars(segments, minGap, stayLabeled);
  // Room for two lines of cities, used or not, so the bars line up across the week.
  const cityRows = showCities ? 2 : 0;
  const citiesTop = size.top;
  const trackTop = citiesTop + cityRows * size.line + (cityRows ? 1 : 0);
  const mid = trackTop + size.track / 2;
  const laneTop = trackTop + size.track + 1;
  // A second layover line just under the first: a date lived twice, after a flight east across the date line.
  const lane2Top = laneTop + size.lane + 2;
  const wordsTop = lane2Top + size.lane + 2;
  const height = wordsTop + size.line;

  // Each labeled layover's words, and where they go: under its line, or up top when they don't fit their piece and
  // the top line is free.
  const stayWords: { s: (typeof bars.stays)[number]; up: boolean; center: number; words: ReactNode }[] = [];
  // Left to right, so two layovers on one day (a short one, then the night's) never print on top of each other: a label
  // that would run into the one before it says less, or moves up to the top line when that's free.
  let lastRight = -Infinity;
  for (const s of bars.stays.filter((st) => st.labeled).sort((a, b) => a.start - b.start)) {
    const piece = x(s.end) - x(s.start);
    const mark = cityPreferences?.[s.city] ? MARK_PX : 0;
    const mid = (x(s.start) + x(s.end)) / 2;
    const place = (w: number) => Math.min(Math.max(mid, w / 2 - bleed), width + bleed - w / 2);
    let fit = fitLayoverLabel(s.city, s.hours, width + 2 * bleed, mark);
    let center = place(fit.widthPx);
    if (center - fit.widthPx / 2 < lastRight + 4) {
      // Only the room to the right of the last label: shorter words, nudged clear of it.
      const room = width + bleed - (lastRight + 4);
      fit = fitLayoverLabel(s.city, s.hours, room, mark);
      center = Math.max(place(fit.widthPx), lastRight + 4 + fit.widthPx / 2);
    }
    const crowded = center - fit.widthPx / 2 < lastRight + 4 || center + fit.widthPx / 2 > width + bleed + 1;
    const up = top == null && !stayWords.some((w) => w.up) && (fit.widthPx > piece + 4 || crowded);
    if (crowded && !up) continue;
    if (!up) lastRight = center + fit.widthPx / 2;
    stayWords.push({
      s,
      up,
      center,
      words: <LayoverWords city={s.city} hours={s.hours} prefix={fit.prefix} withHours={fit.hours} international={!!internationalCities?.has(s.city)} mark={<CityMarkGlyph mark={cityPreferences?.[s.city]} />} />,
    });
  }

  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      {top != null && (
        <div className="absolute inset-x-0 top-0 flex items-center overflow-hidden whitespace-nowrap" style={{ height: size.top }}>
          {top}
        </div>
      )}
      {[6, 12, 18].map((h) => (
        <span key={h} className="absolute w-px bg-ink/20" style={{ left: x(h * 60), top: trackTop + size.track - 3, height: 3 }} />
      ))}
      {bars.duty.map((d, i) => (
        <span key={`d${i}`} className="absolute rounded-[2px] bg-calendar-accent/20" style={{ left: x(d.start), width: x(d.end) - x(d.start), top: mid - size.duty / 2, height: size.duty }} />
      ))}
      {/* Hotel standby: a solid violet line where the flying would be, running on into the next day as a flight does. */}
      {bars.standby.map((d, i) => {
        const runsIn = d.start <= 0;
        const runsOn = d.end >= DAY;
        const left = x(d.start) - (runsIn ? bleed : 0);
        return (
          <span
            key={`s${i}`}
            className={`absolute bg-standby ${runsIn ? "" : "rounded-l-full"} ${runsOn ? "" : "rounded-r-full"}`}
            style={{ left, width: Math.max(2, x(d.end) + (runsOn ? bleed : 0) - left), top: mid - size.bar / 2, height: size.bar }}
            title="Hotel standby"
          />
        );
      })}
      {/* A crew-rest hotel during a long sit at a hub: a gold line under the flying, as a layover is green. */}
      {bars.rests.map((r, i) => {
        const left = x(r.start);
        const w = Math.max(2, x(r.end) - left);
        const text = `Rest ${Math.round(r.hours)}h`;
        const half = (text.length * LABEL_CHAR_PX) / 2;
        const center = Math.min(Math.max(left + w / 2, half - bleed), width + bleed - half);
        const clear = w >= half && !stayWords.some((sw) => !sw.up && Math.abs(sw.center - center) < half + 30);
        return (
          <span key={`r${i}`}>
            <span className="absolute rounded-full bg-rest" style={{ left, width: w, top: laneTop, height: size.lane }} title={`Rest hotel at ${r.city}, ${Math.round(r.hours)}h`} />
            {clear && (
              <span className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-semibold leading-none text-rest" style={{ left: center, top: wordsTop, height: size.line }}>
                {text}
              </span>
            )}
          </span>
        );
      })}
      {bars.stays.map((s, i) => {
          const runsIn = s.start <= 0;
          const runsOn = s.end >= DAY;
          const left = x(s.start) - (runsIn ? bleed : 0);
          if (s.secondPass) {
            // The second time through the date, on its own line; back up to the usual line where the date is new.
            const y2 = lane2Top + size.lane / 2;
            const y1 = laneTop + size.lane / 2;
            const right = x(s.end) + (runsOn ? bleed : 0);
            const points = s.rejoins ? `${left},${y2} ${Math.max(left, width - 8)},${y2} ${width + bleed},${y1}` : `${left},${y2} ${right},${y2}`;
            return (
              <svg key={`h${i}`} className="absolute left-0 top-0 overflow-visible text-layover" width={width} height={height} aria-hidden>
                <polyline points={points} fill="none" stroke="currentColor" strokeWidth={size.lane} strokeLinecap={runsIn ? "butt" : "round"} strokeLinejoin="round" />
              </svg>
            );
          }
          return (
            <span
              key={`h${i}`}
              className={`absolute bg-layover ${runsIn ? "" : "rounded-l-full"} ${runsOn ? "" : "rounded-r-full"}`}
              style={{ left, width: x(s.end) + (runsOn ? bleed : 0) - left, top: laneTop, height: size.lane }}
            />
          );
        })}
      {stayWords.map(({ s, up, center, words }, i) => (
        <span
          key={`w${i}`}
          className="absolute flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap font-mono text-[10px] font-semibold leading-none text-layover"
          style={{ left: center, top: up ? 0 : wordsTop, height: up ? size.top : size.line }}
          title={`Layover in ${s.city}, ${layoverHours(s.hours)}`}
        >
          {words}
        </span>
      ))}
      {bars.legs.map((l, i) => {
        const east = l.dateLine === "east";
        const tone = east ? "bg-dateline" : l.deadhead ? "bg-deadhead" : "bg-leg";
        const runsIn = l.from === null;
        const runsOn = l.to === null;
        const left = x(l.start) - (runsIn ? bleed : 0);
        // East across the date line, the pilot lands on the same date they left (the ex-pilot's sketch: depart the
        // 10th, land the 10th, the layover on from there): the flight comes down from the flying to the layover line
        // in the date-line color, and the layover carries on from where it lands.
        if (l.back) {
          // East across the date line, his way: from the takeoff back to the landing on its own local clock — earlier the
          // same date, or late the date before — then down onto the date's second layover line.
          const yTop = mid;
          const yBot = lane2Top + size.lane / 2;
          const yEdge = yTop + (yBot - yTop) * l.back.edgeFraction;
          const [x0, y0, x1, y1] =
            l.back.part === "whole"
              ? [x(l.start), yTop, x(l.end), yBot]
              : l.back.part === "departure"
                ? [x(l.start), yTop, -bleed, yEdge]
                : [width + bleed, yEdge, x(l.end), yBot];
          return (
            <span key={`l${i}`} title="Crosses the date line eastbound — lands on the same date it left, or the one before">
              <svg className="absolute left-0 top-0 overflow-visible text-dateline" width={width} height={height} aria-hidden>
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="currentColor" strokeWidth={size.bar} strokeLinecap="round" />
                {l.back.part !== "departure" && <circle cx={x1} cy={y1} r={2.5} fill="currentColor" />}
              </svg>
              {l.back.part !== "arrival" && <span className="absolute w-[2px] rounded-full bg-dateline" style={{ left: x(l.start) - 1, top: mid - size.tick / 2, height: size.tick }} />}
            </span>
          );
        }
        if (east && !runsOn) {
          const x0 = runsIn ? -bleed : x(l.start);
          const x1 = Math.max(x0 + 2, x(l.end));
          const y1 = laneTop + size.lane / 2;
          return (
            <span key={`l${i}`} title="Crosses the date line eastbound — lands on the same date it left">
              <svg className="absolute left-0 top-0 overflow-visible text-dateline" width={width} height={height} aria-hidden>
                <line x1={x0} y1={mid} x2={x1} y2={y1} stroke="currentColor" strokeWidth={size.bar} strokeLinecap="round" />
                <circle cx={x1} cy={y1} r={2.5} fill="currentColor" />
              </svg>
              {!runsIn && <span className="absolute w-[2px] rounded-full bg-dateline" style={{ left: x(l.start), top: mid - size.tick / 2, height: size.tick }} />}
            </span>
          );
        }
        return (
          <span key={`l${i}`}>
            <span className={`absolute ${tone}`} style={{ left, width: Math.max(2, x(l.end) + (runsOn ? bleed : 0) - left), top: mid - size.bar / 2, height: size.bar }} />
            {!runsIn && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ left: x(l.start), top: mid - size.tick / 2, height: size.tick }} />}
            {!runsOn && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ left: x(l.end) - 2, top: mid - size.tick / 2, height: size.tick }} />}
          </span>
        );
      })}
      {showCities && <Labels labels={bars.cities} top={(row) => citiesTop + (cityRows - 1 - row) * size.line} line={size.line} tone="text-ink" width={width} bleed={bleed} />}
    </div>
  );
}
