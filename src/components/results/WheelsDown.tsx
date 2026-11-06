"use client";

import { useEffect, useState } from "react";

/**
 * The interview's end: a freighter, seen from the side, landing on a runway — gear down on the approach, a flare,
 * the main wheels first with a puff of tyre smoke, the nose lowered, a rollout to a stop — then the rankings. Played
 * once, on arriving from the interview (`markLanding`), and never under reduced motion.
 */

const KEY = "line-select:wheels-down:v1";
/** The landing itself (globals.css `.ld-*`), then a beat to read the line under it. */
const LANDING_MS = 2400;
const HOLD_MS = 700;
const FADE_MS = 300;

/** Sets the landing to play on the next arrival at the rankings. */
export function markLanding(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // No landing, then — the rankings open as they always do.
  }
}

/** Where the main wheels touch, in the picture's own units; the plane is drawn with its main wheels at (0, 0). */
const TOUCH_X = 250;
const GROUND_Y = 118;

/** A wide-body freighter in profile, nose to the right: no cabin windows, an amber tail, gear down. */
function Freighter() {
  return (
    <g>
      {/* Far wing and engine, a shade back. */}
      <path d="M8 -15 L-18 -10 L-23 -10 L0 -16 Z" fill="var(--color-ink-faint)" />
      {/* Gear: two main bogies under the wing, one nose wheel. */}
      <g stroke="var(--color-ink-muted)" strokeWidth={1.4} strokeLinecap="round">
        <line x1={0} y1={-11} x2={0} y2={-3.5} />
        <line x1={46} y1={-11} x2={46} y2={-3.5} />
      </g>
      <g fill="var(--color-ink-muted)">
        <circle cx={-2.6} cy={-2.2} r={2.2} />
        <circle cx={2.6} cy={-2.2} r={2.2} />
        <circle cx={46} cy={-2} r={2} />
      </g>
      {/* Fuselage: a rounded nose, a straight body, the tail sweeping up. */}
      <path
        d="M58 -19 C58 -23.5 52 -26.5 43 -26.5 L-38 -26.5 L-60 -28 L-62 -23.5 L-44 -12 L45 -11.5 C52 -11.5 58 -14.5 58 -19 Z"
        fill="var(--color-ink)"
      />
      {/* The fin and tailplane, in amber. */}
      <path d="M-36 -26.5 L-50 -50 L-59 -50 L-60 -27.5 Z" fill="var(--color-accent)" />
      <path d="M-46 -21 L-64 -25 L-67 -21.5 L-51 -18.5 Z" fill="var(--color-accent)" />
      {/* Cockpit windows. */}
      <path d="M47 -23 L53 -23 L55.5 -20.5 L47 -20.5 Z" fill="var(--color-canvas)" />
      {/* Near wing and engine. */}
      <path d="M14 -14.5 L-14 -8.5 L-20 -8.5 L4 -16 Z" fill="var(--color-ink-muted)" />
      <path d="M22 -6.5 H6 A3.2 3.2 0 0 1 6 -12.9 H22 A3.2 3.2 0 0 1 22 -6.5 Z" fill="var(--color-ink)" />
      <path d="M22 -12.9 A3.2 3.2 0 0 1 22 -6.5" fill="none" stroke="var(--color-canvas)" strokeOpacity={0.5} strokeWidth={0.8} />
    </g>
  );
}

export function WheelsDown() {
  const [phase, setPhase] = useState<"off" | "on" | "leaving">("off");
  useEffect(() => {
    let pending = false;
    try {
      pending = window.sessionStorage.getItem(KEY) === "1";
      window.sessionStorage.removeItem(KEY);
    } catch {
      pending = false;
    }
    if (!pending || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("on");
  }, []);
  // Its own timers, so a second run of the effect above (the flag already gone) can't leave the overlay up.
  const showing = phase !== "off";
  useEffect(() => {
    if (!showing) return;
    const fade = window.setTimeout(() => setPhase("leaving"), LANDING_MS + HOLD_MS);
    const done = window.setTimeout(() => setPhase("off"), LANDING_MS + HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [showing]);
  if (!showing) return null;

  const edgeLights = Array.from({ length: 16 }, (_, i) => 176 + i * 30);
  return (
    <div
      aria-hidden
      className={`animate-fade-in pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-canvas/95 backdrop-blur-sm transition-opacity duration-300 ${phase === "leaving" ? "opacity-0" : ""}`}
    >
      <div className="w-[min(680px,94vw)]">
        <svg viewBox="0 0 640 150" className="block w-full overflow-hidden">
          {/* The runway, seen low from the side: its surface, the threshold bars, the centreline. */}
          <path d="M160 108 H640 V130 H146 Z" fill="var(--color-ink)" fillOpacity={0.1} />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={166 + i * 3} y={110 + i * 3} width={14} height={1.6} fill="var(--color-ink)" fillOpacity={0.45} />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <rect key={i} x={214 + i * 48} y={GROUND_Y + 0.2} width={22} height={1.4} fill="var(--color-ink)" fillOpacity={0.35} />
          ))}
          {/* Edge lights, far and near side. */}
          {edgeLights.map((x) => (
            <g key={x} fill="var(--color-ink)">
              <circle cx={x} cy={108} r={1} fillOpacity={0.55} />
              <circle cx={x - 14} cy={130} r={1.3} fillOpacity={0.75} />
            </g>
          ))}
          {/* The approach lights, strobing in sequence towards the runway. */}
          {Array.from({ length: 8 }, (_, i) => (
            <circle key={i} className="ld-rabbit" style={{ animationDelay: `${i * 70}ms` }} cx={40 + i * 14} cy={GROUND_Y} r={1.6} fill="var(--color-accent)" />
          ))}
          {/* The four glide-path lights beside the touchdown zone: two red, two white — on the glide path. */}
          {["#e5484d", "#e5484d", "#f5f2ea", "#f5f2ea"].map((c, i) => (
            <circle key={i} cx={TOUCH_X - 26 + i * 7} cy={138} r={2} fill={c} className="ld-papi" />
          ))}
          {/* Tyre smoke where the main wheels meet the ground. */}
          <g transform={`translate(${TOUCH_X} ${GROUND_Y})`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <circle key={i} className="ld-smoke" style={{ animationDelay: `${1560 + i * 45}ms` }} cx={-i * 4} cy={-2 - (i % 2) * 1.5} r={2.6} fill="var(--color-ink-faint)" />
            ))}
          </g>
          <g transform={`translate(${TOUCH_X} ${GROUND_Y})`}>
            <g className="ld-move">
              <g className="ld-pitch">
                <g transform="scale(1.3)">
                  <Freighter />
                </g>
              </g>
            </g>
          </g>
        </svg>
        <p className="ld-caption mt-4 text-center font-display text-xl font-semibold text-ink">Wheels down &mdash; here are your lines.</p>
      </div>
    </div>
  );
}
