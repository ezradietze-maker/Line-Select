"use client";

import { useReducedMotion } from "motion/react";
import { useId, useRef } from "react";
import { LogoMark } from "@/components/ui/Logo";
import { LOGO_S_PATH, LOGO_VIEWBOX } from "@/lib/logo-geometry";

/**
 * The mark, with a tiny plane that flies its S — the procedure turn — and rolls out on the L's runway when the pointer
 * comes over it. Once per hover; never under reduced motion.
 */
export function LogoFlight({ className = "h-9 w-9" }: { className?: string }) {
  const reduce = useReducedMotion();
  // SMIL refers to elements by id; colons from useId aren't allowed there.
  const id = `logo-flight-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const motionRef = useRef<SVGAnimateMotionElement>(null);
  const flying = useRef(false);
  function fly() {
    const m = motionRef.current;
    if (reduce || !m || flying.current) return;
    flying.current = true;
    m.beginElement();
    window.setTimeout(() => (flying.current = false), 1700);
  }
  return (
    <span className={`relative inline-block ${className}`} onMouseEnter={fly} onFocus={fly}>
      <LogoMark className="h-full w-full" />
      <svg viewBox={LOGO_VIEWBOX} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <g opacity="0">
          {/* The S, then on down the runway to a stop. */}
          <animateMotion id={id} ref={motionRef} begin="indefinite" dur="1.5s" fill="remove" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.3 1" path={`${LOGO_S_PATH} H18`} />
          <animate attributeName="opacity" begin={`${id}.begin`} dur="1.5s" values="0;1;1;0" keyTimes="0;0.1;0.85;1" fill="remove" />
          <path d="M3.4 0 L-2.6 -2.4 L-1.4 0 L-2.6 2.4 Z" fill="var(--logo-accent)" stroke="var(--logo-plate-2)" strokeWidth="0.6" />
        </g>
      </svg>
    </span>
  );
}
