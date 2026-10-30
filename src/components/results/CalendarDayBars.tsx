"use client";

import type { ReactNode } from "react";
import { dayBars, fitLayoverLabel, LABEL_CHAR_PX, layoverHours, sideBySide, type DayBars } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { CityMark } from "@/types/preferences";

const DAY = 24 * 60;

/** A month-calendar day: room for three-letter cities, not for times. */
const SIZE = { top: 11, track: 15, tick: 9, bar: 3, duty: 13, lane: 3, line: 10, labelPx: 22 };

/** How far the duty band runs past the takeoff and landing ticks, so it outlines the flying it holds. */
const DUTY_PAD = 2;

/** One row of a day's picture: the first time through it, or — after a flight east across the date line — the second. */
interface RowFrame {
  /** Its city lines (one or two), the track the flying is on and its middle, the layover line, and the words under it. */
  citiesTop: number;
  cityRows: number;
  trackTop: number;
  mid: number;
  laneTop: number;
  wordsTop: number;
  bottom: number;
}

function rowFrame(top: number, cityRows: number): RowFrame {
  const trackTop = top + cityRows * SIZE.line + (cityRows ? 1 : 0);
  const laneTop = trackTop + SIZE.track + 1;
  const wordsTop = laneTop + SIZE.lane + 2;
  return { citiesTop: top, cityRows, trackTop, mid: trackTop + SIZE.track / 2, laneTop, wordsTop, bottom: wordsTop + SIZE.line };
}

/** Room the pilot's mark for a city (♥, ✕) takes after its name. */
const MARK_PX = 10;

interface CalendarDayBarsProps {
  segments: TimelineSegment[];
  /** Width it's drawn at, measured by the grid (`useMeasuredWidth`) — decides where labels fit. */
  widthPx: number;
  /** Which layover pieces carry their words (`labeledStayPieces`); by default each layover's first piece. */
  stayLabeled?: (s: TimelineSegment) => boolean;
  cityPreferences?: Record<string, CityMark>;
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
  /** The month is on Zulu's clock: a flight across the date line is its plain length, marked where it crosses. */
  zulu?: boolean;
}

/** "+17h", "−17h": how far the local clock jumps crossing the date line. */
const jumpLabel = (minutes: number) => `${minutes > 0 ? "+" : "−"}${Math.round(Math.abs(minutes) / 60)}h`;

/**
 * A squiggle along a line, from x0 to x1 at height y — the ex-pilot's mark for hours the clock jumps rather than flies.
 * Its zigzag is set from `anchor`, where it crosses the line rising: anchored at midnight on both days a squiggle runs
 * across, it carries on through the gap between them as one.
 */
function squiggle(x0: number, x1: number, y: number, anchor: number): string {
  const step = 3;
  const amp = 2.5;
  const points: string[] = [`${x0},${y}`];
  for (let k = Math.ceil((x0 - anchor - step / 2) / step); anchor + step / 2 + k * step < x1; k++) {
    const x = anchor + step / 2 + k * step;
    if (x > x0) points.push(`${x},${y + (k % 2 === 0 ? -amp : amp)}`);
  }
  points.push(`${x1},${y}`);
  return points.join(" ");
}

/** A layover's words: the city, its length to the hour (when there's room), and how the pilot feels about it. */
function LayoverWords({ city, hours, withHours, mark }: { city: string; hours: number; withHours: boolean; mark: ReactNode }) {
  return (
    <>
      <span>{city}</span>
      {withHours && <span className="font-normal"> {layoverHours(hours)}</span>}
      {mark}
    </>
  );
}

/**
 * One day of a line's month calendar as the ex-pilot sketched it over his own line (see `lib/leg-bars.ts`), each
 * thing in its own color so it reads at a glance: a bold line with ticks for each leg — blue flown, magenta
 * deadheaded — the cities over its ends, a grey band around the whole duty period (so a hub turn's wait reads as duty
 * with little flying), and each layover a green line of its own under the flying with "OAK 28h" on it. The trip view's
 * rows keep their own picture (`LegBars`).
 *
 * East across the date line, the hours lived twice get a row of their own under the first time through: the flight
 * bold to where it crosses, the date line a diagonal back and down to that moment on the arrival side's clock, the
 * rest of the flight and the layover on the lower row — his sketch, NRT up top and ANC at the foot of the diagonal.
 */
export function CalendarDayBars({ segments, widthPx, stayLabeled, cityPreferences, minLabelWidth = 60, top, bleed = 0, zulu = false }: CalendarDayBarsProps) {
  const size = SIZE;
  const width = Math.max(widthPx, 1);
  const x = (m: number) => (m / DAY) * width;
  const showCities = width >= minLabelWidth;
  const minGap = (size.labelPx * DAY) / width;
  const bars = dayBars(segments, minGap, stayLabeled);
  // Room for two lines of cities, used or not, so the bars line up across the week.
  const first = rowFrame(size.top, showCities ? 2 : 0);
  // The second time through: on a day with any of it, or with the date line's diagonal reaching down to it.
  const second = bars.second || bars.legs.some((l) => l.back) ? rowFrame(first.bottom + 3, showCities ? 1 : 0) : null;
  const height = (second ?? first).bottom;

  /** Everything on one row: the duty band, standby, rest hotels, layovers and their words, the flying, the cities. */
  const row = (b: DayBars, f: RowFrame, key: string) => {
    const cityCenters = sideBySide(b.cityPoints, width, bleed);
    // Each labeled layover's words, and where they go: under its line, or up top when they don't fit their piece and
    // the top line is free (the first row only).
    const stayWords: { s: (typeof b.stays)[number]; up: boolean; center: number; words: ReactNode }[] = [];
    // Left to right, so two layovers on one day (a short one, then the night's) never print on top of each other: a
    // label that would run into the one before it says less, or moves up to the top line when that's free.
    let lastRight = -Infinity;
    for (const s of b.stays.filter((st) => st.labeled).sort((p, q) => p.start - q.start)) {
      const piece = x(s.end) - x(s.start);
      const mark = cityPreferences?.[s.city] ? MARK_PX : 0;
      const middle = (x(s.start) + x(s.end)) / 2;
      const place = (w: number) => Math.min(Math.max(middle, w / 2 - bleed), width + bleed - w / 2);
      let fit = fitLayoverLabel(s.city, s.hours, width + 2 * bleed, mark);
      let center = place(fit.widthPx);
      if (center - fit.widthPx / 2 < lastRight + 4) {
        // Only the room to the right of the last label: shorter words, nudged clear of it.
        const room = width + bleed - (lastRight + 4);
        fit = fitLayoverLabel(s.city, s.hours, room, mark);
        center = Math.max(place(fit.widthPx), lastRight + 4 + fit.widthPx / 2);
      }
      const crowded = center - fit.widthPx / 2 < lastRight + 4 || center + fit.widthPx / 2 > width + bleed + 1;
      const up = f === first && top == null && !stayWords.some((w) => w.up) && (fit.widthPx > piece + 4 || crowded);
      if (crowded && !up) continue;
      if (!up) lastRight = center + fit.widthPx / 2;
      stayWords.push({
        s,
        up,
        center,
        words: <LayoverWords city={s.city} hours={s.hours} withHours={fit.hours} mark={<CityMarkGlyph mark={cityPreferences?.[s.city]} />} />,
      });
    }
    const mid = f.mid;

    return (
      <span key={key}>
        {[6, 12, 18].map((h) => (
          <span key={h} className="absolute w-px bg-ink/20" style={{ left: x(h * 60), top: f.trackTop + size.track - 3, height: 3 }} />
        ))}
        {/* The whole duty period, report to release: a grey band around the flying, a little past each end of it. */}
        {b.duty.map((d, i) => {
          const runsIn = d.start <= 0;
          const runsOn = d.end >= DAY;
          const left = x(d.start) - (runsIn ? bleed : DUTY_PAD);
          return (
            <span
              key={`d${i}`}
              className={`absolute bg-calendar-accent/30 ${runsIn ? "" : "rounded-l-[3px]"} ${runsOn ? "" : "rounded-r-[3px]"}`}
              style={{ left, width: x(d.end) + (runsOn ? bleed : DUTY_PAD) - left, top: mid - size.duty / 2, height: size.duty }}
            />
          );
        })}
        {/* Hotel standby: a solid violet line where the flying would be, running on into the next day as a flight does. */}
        {b.standby.map((d, i) => {
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
        {b.rests.map((r, i) => {
          const left = x(r.start);
          const w = Math.max(2, x(r.end) - left);
          const text = `Rest ${Math.round(r.hours)}h`;
          const half = (text.length * LABEL_CHAR_PX) / 2;
          const center = Math.min(Math.max(left + w / 2, half - bleed), width + bleed - half);
          const clear = w >= half && !stayWords.some((sw) => !sw.up && Math.abs(sw.center - center) < half + 30);
          return (
            <span key={`r${i}`}>
              <span className="absolute rounded-full bg-rest" style={{ left, width: w, top: f.laneTop, height: size.lane }} title={`Rest hotel at ${r.city}, ${Math.round(r.hours)}h`} />
              {clear && (
                <span className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-semibold leading-none text-rest" style={{ left: center, top: f.wordsTop, height: size.line }}>
                  {text}
                </span>
              )}
            </span>
          );
        })}
        {b.stays.map((s, i) => {
          const runsIn = s.start <= 0 || s.runsIn;
          const runsOn = s.end >= DAY || s.runsOn;
          const left = x(s.start) - (runsIn ? bleed : 0);
          return (
            <span
              key={`h${i}`}
              className={`absolute bg-layover ${runsIn ? "" : "rounded-l-full"} ${runsOn ? "" : "rounded-r-full"}`}
              style={{ left, width: x(s.end) + (runsOn ? bleed : 0) - left, top: f.laneTop, height: size.lane }}
            />
          );
        })}
        {stayWords.map(({ s, up, center, words }, i) => (
          <span
            key={`w${i}`}
            className="absolute flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap font-mono text-[10px] font-semibold leading-none text-layover"
            style={{ left: center, top: up ? 0 : f.wordsTop, height: up ? size.top : size.line }}
            title={`Layover in ${s.city}, ${layoverHours(s.hours)}`}
          >
            {words}
          </span>
        ))}
        {b.legs.map((l, i) => {
          // A date-line flight is drawn in its own leg color too — blue flown, magenta deadheaded — its shape says the rest.
          const tone = l.deadhead ? "bg-deadhead" : "bg-leg";
          const ink = l.deadhead ? "text-deadhead" : "text-leg";
          const left = x(l.start) - (l.runsIn ? bleed : 0);
          const right = x(l.end) + (l.runsOn ? bleed : 0);
          // The ticks: a takeoff and a landing — none where the leg runs on past midnight or is cut at the date line.
          const ticks = (
            <>
              {l.from && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ left: x(l.start), top: mid - size.tick / 2, height: size.tick }} />}
              {l.to && <span className={`absolute w-[2px] rounded-full ${tone}`} style={{ left: x(l.end) - 2, top: mid - size.tick / 2, height: size.tick }} />}
            </>
          );
          const jumpWords = (at: number, minutes: number) =>
            showCities ? (
              <span className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[9px] font-semibold leading-none ${ink}`} style={{ left: Math.min(Math.max(at, 12 - bleed), width + bleed - 12), top: f.citiesTop, height: size.line }}>
                {jumpLabel(minutes)}
              </span>
            ) : null;
          if (l.back && second) {
            // The date line, east: from where the flight crosses it on the departure side's clock, back and down to that
            // same moment on the arrival side's, on the row below — as many hours back as the clock jumps. Across a
            // day's edge it's two pieces, meeting in the gap between the days.
            const yBot = second.mid;
            const yEdge = mid + (yBot - mid) * l.back.edgeFraction;
            const [x0, y0, x1, y1] =
              l.back.part === "whole"
                ? [x(l.start), mid, x(l.end), yBot]
                : l.back.part === "departure"
                  ? [x(l.start), mid, -bleed, yEdge]
                  : [width + bleed, yEdge, x(l.end), yBot];
            // How far the clock jumps back ("−17h"), once per flight: over the half of the diagonal that has more room.
            const labelHere = l.clockJump != null && (l.back.part === "whole" || (l.back.part === "departure") === l.back.edgeFraction >= 0.5);
            return (
              <span key={`l${i}`} title={`Crosses the date line eastbound${l.clockJump != null ? ` — the local clock jumps ${jumpLabel(l.clockJump)}` : ""}`}>
                <svg className={`absolute left-0 top-0 overflow-visible ${ink}`} width={width} height={height} aria-hidden>
                  <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="currentColor" strokeWidth={size.bar} strokeLinecap={l.back.part === "whole" ? "round" : "butt"} />
                </svg>
                {labelHere && Math.abs(x1 - x0) > 26 && jumpWords((x0 + x1) / 2, l.clockJump!)}
              </span>
            );
          }
          if (l.dateLine && zulu) {
            // On Zulu's clock nothing jumps: the flight at its real length, with a zigzag where it crosses and how far the
            // local clock jumps there.
            return (
              <span key={`l${i}`} title={`Crosses the date line ${l.dateLine === "east" ? "eastbound" : "westbound"}${l.mark ? ` — the local clock jumps ${jumpLabel(l.mark.jumpMinutes)}` : ""}`}>
                <span className={`absolute ${tone}`} style={{ left, width: Math.max(2, right - left), top: mid - size.bar / 2, height: size.bar }} />
                {ticks}
                {l.mark && (
                  <>
                    <svg className={`absolute left-0 top-0 overflow-visible ${ink}`} width={width} height={height} aria-hidden>
                      <polyline points={`${x(l.mark.at) - 4},${mid - 5} ${x(l.mark.at) - 1},${mid + 5} ${x(l.mark.at) + 1},${mid - 5} ${x(l.mark.at) + 4},${mid + 5}`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                    </svg>
                    {jumpWords(x(l.mark.at), l.mark.jumpMinutes)}
                  </>
                )}
              </span>
            );
          }
          if (l.jump) {
            // West across the date line, his way: the flight bold for its real length, the clock's jump a squiggle.
            const j0 = l.jump.start <= 0 ? -bleed : x(l.jump.start);
            const j1 = l.jump.end >= DAY ? width + bleed : x(l.jump.end);
            return (
              <span key={`l${i}`} title={`Crosses the date line westbound — the flight in bold, the local clock's ${jumpLabel(l.jump.minutes)} jump as the squiggle`}>
                {j0 > left && <span className={`absolute ${tone}`} style={{ left, width: j0 - left, top: mid - size.bar / 2, height: size.bar }} />}
                {right > j1 && <span className={`absolute ${tone}`} style={{ left: j1, width: right - j1, top: mid - size.bar / 2, height: size.bar }} />}
                <svg className={`absolute left-0 top-0 overflow-visible ${ink}`} width={width} height={height} aria-hidden>
                  <polyline points={squiggle(j0, j1, mid, l.jump.end >= DAY ? j1 : j0)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                </svg>
                {ticks}
                {j1 - j0 > 26 && jumpWords((j0 + j1) / 2, l.jump.minutes)}
              </span>
            );
          }
          return (
            <span key={`l${i}`}>
              <span className={`absolute ${tone}`} style={{ left, width: Math.max(2, right - left), top: mid - size.bar / 2, height: size.bar }} />
              {ticks}
            </span>
          );
        })}
        {/* The cities over the flying, side by side on the line next to it — never stacked. */}
        {f.cityRows > 0 &&
          b.cityPoints.map((c, i) => (
            <span
              key={`c${i}`}
              className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-semibold leading-none ${c.deadhead ? "text-deadhead" : "text-ink"}`}
              style={{ left: cityCenters[i], top: f.citiesTop + (f.cityRows - 1) * size.line, height: size.line }}
            >
              {c.text}
            </span>
          ))}
      </span>
    );
  };

  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      {top != null && (
        <div className="absolute inset-x-0 top-0 flex items-center overflow-hidden whitespace-nowrap" style={{ height: size.top }}>
          {top}
        </div>
      )}
      {row(bars, first, "first")}
      {second && bars.second && row(bars.second, second, "second")}
    </div>
  );
}
