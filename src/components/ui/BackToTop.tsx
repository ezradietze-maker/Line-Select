"use client";

import { useEffect, useState } from "react";

/**
 * A round "top" button once a long screen — three hundred ranked lines, every
 * hotel in the pack — has been scrolled well down, so getting back to the
 * filters isn't a long swipe. Sits above the phone's tab bar.
 */
export function BackToTop() {
  const [show, setShow] = useState(false);
  // Bumped on each press, so the plane's climb replays from the start every time.
  const [launches, setLaunches] = useState(0);

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
      onClick={() => {
        setLaunches((n) => n + 1);
        window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }}
      className={`back-to-top fixed bottom-[calc(var(--shell-bottom)+1rem)] right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface/95 text-ink-muted shadow-elevated backdrop-blur transition-[opacity,transform] duration-200 ease-[var(--ease-emphasized)] hover:text-ink sm:right-6 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      {/* A plane pointing up the page, climbing away out of the button when pressed while the next one rolls up. */}
      <span key={launches} className={`relative h-[18px] w-[18px] ${launches ? "plane-climb" : ""}`} aria-hidden>
        <svg viewBox="0 0 24 24" fill="currentColor" className="absolute inset-0 h-full w-full">
          <path transform="rotate(-90 12 12)" d="M21 12c0-.8-.7-1.2-1.6-1.2H15L10.3 3.6H8.5l2.3 7.2H6.2L4.6 8.6H3.2l1 3.4-1 3.4h1.4l1.6-2.2h4.6l-2.3 7.2h1.8l4.7-7.2h4.4c.9 0 1.6-.4 1.6-1.2z" />
        </svg>
      </span>
    </button>
  );
}
