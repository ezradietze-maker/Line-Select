"use client";

import { motion, useReducedMotion } from "motion/react";
import { FlightPathProgress } from "@/components/ui/FlightPathProgress";
import { Gauge } from "@/components/ui/Gauge";
import { NumberTicker } from "@/components/ui/NumberTicker";
import { EASE } from "@/lib/motion-tokens";

/**
 * The four panels of the landing page's "how it flies" story. Each takes
 * `active` and plays when its step is the one on screen. Every number is
 * real, from one real October 767 Memphis first-officer bid pack, except
 * the illustrative scores in the ranking panel, which say so.
 */

/** Real counts from parsing the October 2026 B767 Memphis pack. */
const PACK = { pages: 263, pairings: 769, lines: 667, cities: 82 };

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">{children}</p>;
}

export function ParseVisual({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <div className="panel-glass flex gap-6 p-6">
        {/* A page of the pack, with the read head passing over it. */}
        <div className="relative h-44 w-32 shrink-0 overflow-hidden rounded-lg border border-hairline bg-surface-raised">
          <div className="space-y-2 p-3" aria-hidden>
            {[90, 70, 84, 60, 92, 75, 66, 88, 58, 80].map((w, i) => (
              <div key={i} className="h-1 rounded-full bg-ink/15" style={{ width: `${w}%` }} />
            ))}
          </div>
          {active && !reduce && (
            <motion.div
              aria-hidden
              className="absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-[var(--glow-strong)] to-transparent"
              initial={{ top: "-20%" }}
              animate={{ top: "110%" }}
              transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }}
            />
          )}
        </div>
        <dl className="grid flex-1 content-center gap-4">
          {[
            ["Pages read", PACK.pages],
            ["Pairings", PACK.pairings],
            ["Lines", PACK.lines],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">{label}</dt>
              <dd className="text-readout text-3xl font-semibold">
                {active ? <NumberTicker key="on" value={value as number} duration={1.4} /> : <span>0</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <motion.div
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-good/40 bg-good-soft px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-good"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ delay: active ? 1.5 : 0, duration: 0.4 }}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        Loaded &middot; {PACK.cities} layover cities
      </motion.div>
      <Caption>A real October 767 Memphis bid pack &middot; parsed in about two seconds</Caption>
    </div>
  );
}

const QUESTION = "Two early shows back to back — where does it start to wear on you?".split(" ");

export function InterviewVisual({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const pick = 2;
  return (
    <div>
      <div className="panel-glass p-6">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">Question 7</div>
        <p className="mt-2 font-display text-xl font-semibold leading-snug text-ink">
          {QUESTION.map((w, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={false}
              animate={{ opacity: active || reduce ? 1 : 0.15 }}
              transition={{ delay: active && !reduce ? i * 0.06 : 0, duration: 0.3 }}
            >
              {w}&nbsp;
            </motion.span>
          ))}
        </p>
        <div className="relative mt-5 grid grid-cols-5 rounded-xl border border-hairline bg-canvas/60 p-1 text-center font-mono text-sm">
          <motion.div
            aria-hidden
            className="absolute inset-y-1 rounded-lg bg-accent-soft ring-1 ring-accent/50"
            style={{ width: "calc((100% - 0.5rem) / 5)" }}
            initial={false}
            animate={{ left: `calc(0.25rem + (100% - 0.5rem) / 5 * ${active ? pick : 0})` }}
            transition={{ delay: active && !reduce ? 0.9 : 0, duration: reduce ? 0 : 0.5, ease: EASE.emphasized }}
          />
          {[0, 1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`relative py-2 transition-colors duration-300 ${active && n === pick ? "font-semibold text-accent" : "text-ink-muted"}`}
              // Lights up as the selection arrives, not before it.
              style={{ transitionDelay: active && !reduce ? "1100ms" : "0ms" }}
            >
              {n}
            </div>
          ))}
        </div>
        <div className="mt-1 text-right font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">in a row</div>
        <motion.p
          className="mt-4 rounded-lg border-l-2 border-accent bg-canvas/60 px-3 py-2 text-sm italic text-ink-muted"
          initial={false}
          animate={{ opacity: active ? 1 : 0 }}
          transition={{ delay: active && !reduce ? 1.4 : 0, duration: 0.4 }}
        >
          &ldquo;Two&rsquo;s fine. Three and I&rsquo;m running on fumes.&rdquo;
        </motion.p>
        <FlightPathProgress className="mt-5" fraction={active ? 0.55 : 0.3} label="Interview progress" origin="Takeoff" destination="Your ranking" waypoints={3} />
      </div>
      <Caption>Asks the way a pilot would &middot; learns how you talk</Caption>
    </div>
  );
}

const LINES = [
  { n: "2016", off: 15, credit: 73.8, via: "SJC · MIA · BOG", score: 73 },
  { n: "2024", off: 15, credit: 77.5, via: "CDG · BLL · DUB", score: 84 },
  { n: "2033", off: 15, credit: 79.9, via: "CDG · DUB · MXP", score: 88 },
  { n: "2035", off: 15, credit: 78.1, via: "CDG · DUB · MXP", score: 81 },
  { n: "2164", off: 15, credit: 81.9, via: "SAT · ELP · DTW", score: 67 },
];

export function RankVisual({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const rows = active ? [...LINES].sort((a, b) => b.score - a.score) : LINES;
  return (
    <div>
      <ol className="panel-glass space-y-1.5 p-3">
        {rows.map((l, i) => (
          <motion.li
            key={l.n}
            layout={!reduce}
            transition={{ type: "spring", stiffness: 260, damping: 30, delay: active ? 0.15 : 0 }}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 ${active && i === 0 ? "glow-soft bg-accent-soft/60" : "bg-canvas/40"}`}
          >
            <span className="w-6 font-mono text-xs text-ink-faint">#{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-semibold tracking-wide text-ink">Line {l.n}</div>
              <div className="truncate font-mono text-[11px] text-ink-faint">
                {l.off} off &middot; {l.credit.toFixed(1)} cr &middot; {l.via}
              </div>
            </div>
            {active ? (
              <Gauge
                value={l.score}
                size={40}
                tone={{ stroke: "var(--color-accent)", track: "var(--color-accent-soft)", text: "text-readout" }}
                label={`Illustrative score ${l.score}`}
                readoutClassName="text-[11px] font-semibold"
              />
            ) : (
              <div className="h-10 w-10" />
            )}
          </motion.li>
        ))}
      </ol>
      <Caption>Real lines from that pack &middot; illustrative scores</Caption>
    </div>
  );
}

/** Line 2033's real month in that pack: 13 days off in a row, then one European trip. */
const MONTH: (string | null)[] = [
  null, null, null, null, null, null, null, null, null, null, null, null, null,
  "CDG", "DUB", "MXP", "BLL", "MXP", "BLL", "CDG", "", "", "", "", "", "",
  null, null,
];

export function CalendarVisual({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const start = new Date(Date.UTC(2026, 8, 28));
  let trip = -1;
  return (
    <div>
      <div className="panel-glass p-5">
        <div className="mb-2 grid grid-cols-7 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {MONTH.map((code, i) => {
            const date = new Date(start.getTime() + i * 86_400_000).getUTCDate();
            const flying = code !== null;
            if (flying) trip++;
            return (
              <motion.div
                key={i}
                className={`flex h-12 flex-col justify-between rounded-md border p-1 text-left ${
                  flying ? "border-accent/40" : "border-dashed border-hairline"
                }`}
                initial={false}
                animate={{ backgroundColor: flying && active ? "var(--color-accent-soft)" : "rgba(0,0,0,0)" }}
                transition={{ delay: flying && active && !reduce ? 0.2 + trip * 0.08 : 0, duration: reduce ? 0 : 0.35 }}
              >
                <span className="font-mono text-[10px] text-ink-faint">{date}</span>
                {code && <span className="font-mono text-[10px] font-semibold text-accent">{code}</span>}
              </motion.div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-6">
          {[
            ["Days off", 15],
            ["In a row", 13],
            ["Trips", 1],
          ].map(([label, v]) => (
            <div key={label as string}>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</div>
              <div className="text-readout text-xl font-semibold">{active ? <NumberTicker key="on" value={v as number} /> : 0}</div>
            </div>
          ))}
        </div>
      </div>
      <Caption>Line 2033&rsquo;s real month &middot; Sep 28 &ndash; Oct 25</Caption>
    </div>
  );
}
