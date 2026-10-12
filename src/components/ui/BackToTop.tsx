"use client";

import { useEffect, useState } from "react";
import { ArrowUpIcon } from "@/components/ui/icons";

/**
 * A round "top" button once a long screen — three hundred ranked lines, every
 * hotel in the pack — has been scrolled well down, so getting back to the
 * filters isn't a long swipe. Sits above the phone's tab bar.
 */
export function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setShow(window.scrollY > window.innerHeight * 1.5));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      className={`back-to-top fixed bottom-[calc(var(--shell-bottom)+1rem)] right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface/95 text-ink-muted shadow-elevated backdrop-blur transition-[opacity,transform] duration-200 ease-[var(--ease-emphasized)] hover:text-ink sm:right-6 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <ArrowUpIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
