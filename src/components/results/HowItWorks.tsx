"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Heading } from "@/components/ui/Heading";

interface Point {
  icon: ReactNode;
  title: string;
  body: ReactNode;
}

const POINTS: Point[] = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    title: "How your score is built",
    body: (
      <>
        Line Select reads your own uploaded bid pack PDF and measures each
        line&rsquo;s real makeup &mdash; days off and when they fall, trip
        length, duty periods, show times, flying on the backside of the clock,
        credit, deadheads, layover cities and hotels, and your time away from
        home if you commute &mdash; then scores it 0&ndash;100 against the
        priorities your interview set, each counting as much as it matters
        to you.
      </>
    ),
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11H9l-5 4V5z" />
        <path strokeLinecap="round" d="M8 9.5h8M8 12.5h5" />
      </svg>
    ),
    title: "Your priorities come from your own story",
    body: (
      <>
        The interview starts with how you bid, start to finish, in your own
        words; then your commute and how you feel about each layover city.
        Every question after that comes from what you said, using your
        pack&rsquo;s real lines and trips. When two of your priorities pull
        against each other, it puts two real lines side by side and asks which
        you&rsquo;d bid, and you can grade a few trips &mdash; those answers
        set how much each priority counts. You check your priorities before
        anything is ranked.
      </>
    ),
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v4m0 3.5h.01" />
      </svg>
    ),
    title: "What this isn’t",
    body: (
      <>
        <strong className="text-ink">
          The match score predicts your satisfaction, not what you&rsquo;ll be awarded.
        </strong>{" "}
        It only tells you which lines, on paper, look closest to what you said
        you want. If you give your seniority number, a separate estimate shows
        your chance at each line from where you sit in bid order &mdash; a
        statistical guess that gets sharper as more pilots use the app, never
        a promise of what you&rsquo;ll actually hold.
      </>
    ),
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path strokeLinecap="round" d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    ),
    title: "What happens to your bid pack",
    body: (
      <>
        Your bid pack PDF is uploaded to this app&rsquo;s own server to be
        parsed &mdash; never to FedEx or any third party &mdash; and the PDF
        itself isn&rsquo;t stored once parsing finishes. The extracted line
        data and your preferences are then stored on this device, and on the
        server too if you create an account. Beyond the upload itself, the
        server sees: your interview answers, your questions to Ask your pack
        and Ask the contract, and the reason you type for swapping or
        correcting lines (each sent to an AI provider to answer it); hotel
        names (looked up on Google); if you commute, the airports you fly
        from, the times around your trips and the pack&rsquo;s own flights, to
        look up real commuting flights; your seniority number and line
        ranking if you ask for a bid forecast (numbers only, never the pack);
        a numeric summary of your finished interview (never your words) that
        helps it ask future pilots better questions; and anything you post
        to the Trade Board or send as feedback. The Privacy Policy has the
        full list.
      </>
    ),
  },
];

/** The nearest box that scrolls this element, or the page. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null;
}

/**
 * How far down the route the reader has come — as a share of the line, and as the number of waypoints reached — where
 * it crosses a line three-quarters of the way down the screen; or all of it, once there's nowhere further to scroll.
 */
function useReadProgress(list: React.RefObject<HTMLUListElement | null>): { progress: number; reached: number } {
  const [read, setRead] = useState({ progress: 0, reached: 0 });
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setRead({ progress: 1, reached: POINTS.length }));
      return () => cancelAnimationFrame(id);
    }
    const scroller = scrollerOf(el);
    let frame = 0;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const atEnd = scroller
        ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
        : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (atEnd && box.bottom <= window.innerHeight) {
        setRead({ progress: 1, reached: POINTS.length });
        return;
      }
      const reading = window.innerHeight * 0.75;
      const reached = [...el.children].filter((c) => c.tagName === "LI" && c.getBoundingClientRect().top + 18 <= reading).length;
      setRead({ progress: Math.min(1, Math.max(0, (reading - box.top) / box.height)), reached });
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    onScroll();
    // Capturing, so a scroll inside the sidebar's dialog counts as well as the page's own.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [list]);
  return read;
}

/**
 * The four things worth knowing, as waypoints down one route line that lights up as it's read: the line filling in
 * amber, each waypoint coming on as the reader reaches it. Also shown in the sidebar's "How this works" dialog.
 */
export function HowItWorksContent({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" } = {}) {
  const list = useRef<HTMLUListElement>(null);
  const { progress, reached } = useReadProgress(list);
  return (
    <ul ref={list} className="relative space-y-6">
      <span aria-hidden className="absolute bottom-4 left-[17px] top-4 w-px bg-hairline" />
      <span
        aria-hidden
        // Read so far: the green centreline, drawn down the list as you go.
        className="absolute bottom-4 left-[17px] top-4 w-0.5 -translate-x-[0.5px] origin-top bg-good transition-transform duration-200 ease-out"
        style={{ transform: `scaleY(${progress})` }}
      />
      {POINTS.map((point, i) => {
        const lit = i < reached;
        return (
          <li key={point.title} className="relative flex gap-4">
            <div
              // Each point turns into a location sign (yellow on black) once it's been read.
              className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border transition-[color,border-color,background-color] duration-300 ${
                lit ? "border-sign bg-on-sign text-sign" : "border-border bg-panel text-ink-faint"
              }`}
            >
              {point.icon}
            </div>
            <div className="min-w-0 pt-1.5">
              <Heading as={headingLevel} className="text-base text-ink">
                {point.title}
              </Heading>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{point.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
