"use client";

import { useEffect, useState } from "react";

/**
 * The interview's end: a plane touching down on a runway, then the rankings. Played once, on arriving from the
 * interview (`markLanding`), and never under reduced motion.
 */

const KEY = "line-select:wheels-down:v1";

/** Sets the landing to play on the next arrival at the rankings. */
export function markLanding(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // No landing, then — the rankings open as they always do.
  }
}

export function WheelsDown() {
  const [show, setShow] = useState(false);
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
    setShow(true);
  }, []);
  // Its own timer, so a second run of the effect above (the flag already gone) can't leave the overlay up.
  useEffect(() => {
    if (!show) return;
    const id = window.setTimeout(() => setShow(false), 2300);
    return () => window.clearTimeout(id);
  }, [show]);
  if (!show) return null;
  return (
    <div aria-hidden className="animate-fade-in pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-canvas/85 backdrop-blur-[2px]">
      <div className="relative w-[min(560px,86vw)]">
        <div className="wheels-down absolute bottom-3 left-1/2 -ml-4 text-accent">
          <svg viewBox="-4 -4 8 8" className="h-8 w-8">
            <path d="M3.4 0 L-2.6 -2.4 L-1.4 0 L-2.6 2.4 Z" fill="currentColor" />
          </svg>
        </div>
        {/* The runway: its centerline and its edge lights. */}
        <div className="h-2 rounded-full bg-ink/15" />
        <div className="runway-lights mt-1.5 flex justify-between px-1">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-accent" style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </div>
        <p className="mt-6 text-center font-display text-xl font-semibold text-ink">Wheels down &mdash; here are your lines.</p>
      </div>
    </div>
  );
}
