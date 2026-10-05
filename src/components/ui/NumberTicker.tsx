"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { DURATION, EASE } from "@/lib/motion-tokens";

interface NumberTickerProps {
  value: number;
  /** How the number is printed at every frame — e.g. `(n) => n.toFixed(1)`. Defaults to a whole number. */
  format?: (n: number) => string;
  /** Where the first count starts from. Later changes always tick from the previous value. */
  from?: number;
  duration?: number;
  className?: string;
}

const wholeNumber = (n: number) => String(Math.round(n));

/**
 * A number that ticks between values instead of snapping — the readout on an
 * instrument rather than text being replaced. Starts counting only once it's
 * on screen, so a list of them doesn't spend its animation off-screen.
 * Reduced motion: the final value, immediately.
 *
 * Writes the text straight to the DOM each frame rather than through React
 * state, so a page full of these doesn't re-render dozens of times a second.
 * The counting digits are hidden from screen readers, which get the real
 * value from a visually hidden copy instead of hearing "0" for a number that
 * hasn't scrolled into view yet.
 */
export function NumberTicker({ value, format = wholeNumber, from = 0, duration = DURATION.reveal, className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduceMotion = useReducedMotion();
  // Kept in a ref so a new inline `format` function each render doesn't restart the count.
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    const start = shown.current ?? from;
    if (reduceMotion || start === value) {
      shown.current = value;
      el.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(start, value, {
      duration,
      ease: EASE.emphasized,
      onUpdate: (n) => {
        shown.current = n;
        el.textContent = formatRef.current(n);
      },
    });
    return () => controls.stop();
  }, [value, inView, reduceMotion, duration, from]);

  return (
    <span className={`font-tabular ${className ?? ""}`}>
      <span ref={ref} aria-hidden>
        {format(from)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
