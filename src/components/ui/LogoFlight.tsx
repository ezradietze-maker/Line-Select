"use client";

import { useReducedMotion } from "motion/react";
import { useRef } from "react";
import { LogoMark } from "@/components/ui/Logo";

/**
 * The mark, catching a taxi light: when the pointer comes over it, a glint sweeps once across the sign the way
 * retroreflective lettering flares as a light passes. Once per hover; never under reduced motion.
 */
export function LogoFlight({ className = "h-9 w-9" }: { className?: string }) {
  const reduce = useReducedMotion();
  const glint = useRef<HTMLSpanElement>(null);
  function sweep() {
    const el = glint.current;
    if (reduce || !el || el.getAnimations().length) return;
    el.animate([{ transform: "translateX(-110%)" }, { transform: "translateX(110%)" }], {
      duration: 700,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
  }
  return (
    <span className={`relative inline-block overflow-hidden rounded-[15.6%] ${className}`} onMouseEnter={sweep} onFocus={sweep}>
      <LogoMark className="h-full w-full" />
      <span
        ref={glint}
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-[110%] bg-[linear-gradient(105deg,transparent_35%,rgb(255_255_255/0.45)_50%,transparent_65%)]"
      />
    </span>
  );
}
