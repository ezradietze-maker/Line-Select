"use client";

import { useEffect, useState } from "react";
import { PlaneIcon } from "@/components/ui/icons";

/**
 * How far down a long page you've read, as a flight: a dashed track across the top, flown in amber up to a small plane
 * at the reading point. Appears once you start scrolling; out of the way of the phone's own header.
 */
export function ReadingProgress() {
  const [f, setF] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setF(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div aria-hidden className={`pointer-events-none sticky top-[3.25rem] z-20 -mx-4 h-0 transition-opacity duration-300 md:top-0 print:hidden ${f > 0.01 ? "opacity-100" : "opacity-0"}`}>
      {/* On a strip of the page's own canvas, so the line never reads as crossing out the text scrolling under it. */}
      <div className="bg-canvas/90 px-4 backdrop-blur-sm">
        <div className="relative h-5">
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border-strong" />
          <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${f * 100}%` }} />
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent" style={{ left: `${f * 100}%` }}>
            <PlaneIcon className="h-3.5 w-3.5 rotate-45" />
          </span>
        </div>
      </div>
    </div>
  );
}
