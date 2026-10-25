"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dayBars, type BarLabel } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import type { CityMark } from "@/types/preferences";

const DAY = 24 * 60;
const pct = (m: number) => `${(m / DAY) * 100}%`;

/** The width an element is drawn at, kept up to date — one observer per grid or trip, not per day. */
export function useMeasuredWidth<T extends HTMLElement>(initial: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width || initial);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, width];
}

type Variant = "cell" | "row";

const SIZES: Record<Variant, { track: number; tick: number; duty: number; line: number; labelPx: number }> = {
  // A month-calendar day: room for three-letter cities, not for times.
  cell: { track: 12, tick: 8, duty: 6, line: 11, labelPx: 22 },
  // A trip's day row: wide enough for each leg's times above its ends.
  row: { track: 18, tick: 11, duty: 8, line: 12, labelPx: 36 },
};

/** Labels are centered under their tick, nudged in at the day's edges so they stay inside it (`half`: half a label's width, in minutes). */
function Labels({ labels, top, line, tone, half }: { labels: BarLabel[]; top: (row: 0 | 1) => number; line: number; tone: string; half: number }) {
  return (
    <>
      {labels.map((l, i) => (
        <span
          key={i}
          className={`absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] leading-none ${tone}`}
          style={{ left: pct(Math.min(Math.max(l.at, half), DAY - half)), top: top(l.row), height: line }}
        >
          {l.text}
        </span>
      ))}
    </>
  );
}

interface LegBarsProps {
  segments: TimelineSegment[];
  variant: Variant;
  /** Width it's drawn at, measured by the parent (`useMeasuredWidth`) — decides where labels fit. */
  widthPx: number;
  /** Print each leg's times over its ends (trip rows). */
  times?: boolean;
  /** Draw the hotel stays as a quiet line, with the city and how long on its longest piece (trip rows). */
  stays?: boolean;
  /** Which hotel-stay pieces carry their words (`labeledStayPieces`); by default each stay's first piece. */
  stayLabeled?: (s: TimelineSegment) => boolean;
  cityPreferences?: Record<string, CityMark>;
  /** Behind a stay's words, so they sit cleanly over its line — the surface the row is drawn on. */
  labelBg?: string;
  /** Under a width this narrow, the cities don't fit: bars only. */
  minLabelWidth?: number;
  /** The words on a stay, in place of "SEA 15h48 ♥" — handed the pilot's mark for the city to place. */
  formatStay?: (stay: { city: string; hours: number; hotel: string | null }, mark: ReactNode) => ReactNode;
}

/** "15.8" hours → "15h48". */
export function stayHours(hours: number): string {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/**
 * One day's flying as bars on a midnight-to-midnight track (see `lib/leg-bars.ts`): a line with ticks for each leg,
 * dashed for a deadhead, a faint band under the time on duty (so a hub turn's wait reads as duty with little flying),
 * and the cities under the ends of the legs. Nothing else: the ex-pilot's own organizer had only the lines.
 */
export function LegBars({ segments, variant, widthPx, times = false, stays = false, stayLabeled, cityPreferences, labelBg = "bg-surface", minLabelWidth = 60, formatStay }: LegBarsProps) {
  const size = SIZES[variant];
  const width = Math.max(widthPx, 1);
  const showCities = width >= minLabelWidth;
  const minGap = (size.labelPx * DAY) / width;
  const bars = dayBars(segments, minGap, stayLabeled);
  const timeRows = times ? (bars.times.some((t) => t.row === 1) ? 2 : bars.times.length ? 1 : 0) : 0;
  const cityRows = showCities ? (bars.cities.some((c) => c.row === 1) ? 2 : bars.cities.length ? 1 : 0) : 0;
  const trackTop = timeRows * size.line + (timeRows ? 2 : 0);
  const mid = trackTop + size.track / 2;
  const height = trackTop + size.track + (cityRows ? 2 + cityRows * size.line : 0);

  return (
    <div className="relative w-full" style={{ height }} aria-hidden>
      {[6, 12, 18].map((h) => (
        <span key={h} className="absolute w-px bg-ink/20" style={{ left: pct(h * 60), top: trackTop + size.track - 3, height: 3 }} />
      ))}
      {bars.duty.map((d, i) => (
        <span key={`d${i}`} className="absolute rounded-[2px] bg-calendar-accent/20" style={{ left: pct(d.start), width: pct(d.end - d.start), top: mid - size.duty / 2, height: size.duty }} />
      ))}
      {bars.standby.map((d, i) => (
        <span key={`s${i}`} className="absolute rounded-[2px] bg-standby/45" style={{ left: pct(d.start), width: pct(d.end - d.start), top: mid - size.duty / 2, height: size.duty }} />
      ))}
      {stays &&
        bars.stays.map((s, i) => (
          <span key={`h${i}`}>
            <span className="absolute bg-good/50" style={{ left: pct(s.start), width: pct(s.end - s.start), top: mid - 1, height: 2 }} />
            {s.labeled && (
              <span
                className="absolute flex min-w-0 items-center overflow-hidden"
                style={{ left: `calc(${pct(s.start)} + 6px)`, maxWidth: `calc(${pct(s.end - s.start)} - 10px)`, top: mid - 7, height: 14 }}
              >
                <span className={`flex min-w-0 items-center gap-0.5 truncate px-1 font-mono text-[10px] font-semibold leading-none text-good ${labelBg}`}>
                  {formatStay ? (
                    formatStay(s, <CityMarkGlyph mark={cityPreferences?.[s.city]} />)
                  ) : (
                    <>
                      {s.city} {stayHours(s.hours)}
                      <CityMarkGlyph mark={cityPreferences?.[s.city]} />
                    </>
                  )}
                </span>
              </span>
            )}
          </span>
        ))}
      {bars.legs.map((l, i) => (
        <span key={`l${i}`}>
          <span
            className={`absolute ${l.deadhead ? "border-t-2 border-dashed border-ink-muted" : "bg-ink"}`}
            style={{ left: pct(l.start), width: `max(2px, ${pct(l.end - l.start)})`, top: mid - 1, height: l.deadhead ? 0 : 2 }}
          />
          {l.from && <span className={`absolute w-[1.5px] ${l.deadhead ? "bg-ink-muted" : "bg-ink"}`} style={{ left: pct(l.start), top: mid - size.tick / 2, height: size.tick }} />}
          {l.to ? (
            <span className={`absolute w-[1.5px] ${l.deadhead ? "bg-ink-muted" : "bg-ink"}`} style={{ left: `calc(${pct(l.end)} - 1.5px)`, top: mid - size.tick / 2, height: size.tick }} />
          ) : (
            <span className="absolute h-0 w-0 border-y-[4px] border-l-[5px] border-y-transparent border-l-ink" style={{ left: `calc(${pct(l.end)} - 5px)`, top: mid - 4 }} />
          )}
        </span>
      ))}
      {times && <Labels labels={bars.times} top={(row) => (timeRows === 2 && row === 0 ? size.line : 0)} line={size.line} tone="text-ink-muted" half={minGap / 2} />}
      {showCities && <Labels labels={bars.cities} top={(row) => trackTop + size.track + 2 + row * size.line} line={size.line} tone="font-semibold text-ink" half={minGap / 2} />}
    </div>
  );
}
