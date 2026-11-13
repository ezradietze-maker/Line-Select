"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { LANDING_DONE_EVENT, landingUnderway } from "@/components/results/WheelsDown";
import { nextStop } from "@/lib/focus-trap";
import { lockScroll, overlayOpen } from "@/lib/scroll-lock";

/**
 * A pilot's first look at the rankings: four tips, each lighting up the part of the screen it's about, once per
 * device. Skippable at any point; a tip whose part isn't on screen (the sidebar on a phone) is left out. While it's up
 * the page holds still and Tab stays in the tip: scrolled, the tip went off the screen and left only the dimmed page.
 * It waits for the screen to be the pilot's alone: not over a dialog they opened (it sat under or over it), not over
 * the landing from the interview, and not on a visit that came for one line (it scrolled away from it) — that one has
 * it next time. Done, the page goes back where it was, with focus on the list's heading.
 */

const DONE_KEY = "line-select:tour:results:v1";

const STEPS: { target: string; title: string; body: string }[] = [
  { target: 'section[aria-label="This month\'s bid"]', title: "Your bid at a glance", body: "When bidding closes, counted down — and the month's bid step by step. Tick \"bid entered\" when you've put it in the bid system." },
  { target: 'section[aria-label="Ask your pack"]', title: "Ask your pack", body: "Ask in plain words — \"lines with Honolulu and no weekends worked\" — and get the pack's own lines back, with the figures behind each." },
  { target: '[id^="line-"]', title: "Your lines, best first", body: "Each line reads like the bid pack's own page. Tap one for its whole month. Ranked something wrong? Drag its handle onto another line to swap them — that teaches the ranking." },
  { target: '[role="group"][aria-label="Your flying"]', title: "Beyond this bid", body: "Your layover cities, your logbook of awards, and tools like the world clock and commute planner live here." },
];

/** Room around the lit part, between it and the tip, and from the screen's edges. */
const PAD = 6;
const GAP = 10;
const EDGE = 12;
/** How long after the list shows the first tip comes up; how often it looks again while a dialog is open; the beat after the landing. */
const START_MS = 1200;
const RETRY_MS = 700;
const AFTER_LANDING_MS = 400;
/** Keys that scroll the page, held while the tour is up (a Space on one of its buttons still presses it). */
const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);

function shown(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/**
 * `ready`: the list is showing. `skip`: a line was asked for on this visit (`/results?line=`, or the palette before the
 * tour came up) — the pilot came for that line, so the tour waits for a visit of their own.
 */
export function FirstVisitTour({ ready, skip = false }: { ready: boolean; skip?: boolean }) {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The tip's own height, once drawn (a guess before): where it goes depends on it fitting.
  const [cardHeight, setCardHeight] = useState(180);
  // Where the page was when the tour came up, to go back to after it.
  const scrollBefore = useRef(0);

  useEffect(() => {
    if (!ready || skip) return;
    let done = true;
    try {
      done = window.localStorage.getItem(DONE_KEY) === "done";
    } catch {
      // No storage, no way to remember it was seen: better no tour than one on every visit.
    }
    if (done) return;
    let id = 0;
    const later = (ms: number) => {
      window.clearTimeout(id);
      id = window.setTimeout(tryStart, ms);
    };
    function tryStart() {
      // The landing says when it's down (LANDING_DONE_EVENT, below); a dialog the pilot opened is waited out.
      if (landingUnderway()) return;
      if (overlayOpen()) return later(RETRY_MS);
      scrollBefore.current = window.scrollY;
      setStep(0);
    }
    const afterLanding = () => later(AFTER_LANDING_MS);
    window.addEventListener(LANDING_DONE_EVENT, afterLanding);
    later(START_MS);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener(LANDING_DONE_EVENT, afterLanding);
    };
  }, [ready, skip]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(DONE_KEY, "done");
    } catch {
      // Nothing to remember it in.
    }
    setStep(null);
    // Back where the page was before the tour moved it, with focus on the list's heading: left on the tip's button,
    // which is gone, focus fell to the page's body and the next Tab started from the top.
    window.scrollTo({ top: scrollBefore.current, behavior: "instant" });
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, []);

  // The steps whose part is on screen, from `from` on.
  const nextShown = useCallback((from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < STEPS.length; i += dir) if (shown(document.querySelector(STEPS[i].target))) return i;
    return null;
  }, []);

  const go = useCallback(
    (to: number, dir: 1 | -1) => {
      const i = nextShown(to, dir);
      if (i === null) {
        if (dir === 1) finish();
        return;
      }
      setStep(i);
    },
    [nextShown, finish]
  );

  // Measured once each tip is drawn, before it shows: a longer tip may no longer fit where the guess put it.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardHeight) setCardHeight(h);
  }, [step, rect, cardHeight]);

  useLayoutEffect(() => {
    if (step === null) return;
    const el = document.querySelector(STEPS[step].target);
    if (!shown(el)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      go(step + 1, 1);
      return;
    }
    // Scrolled so the part and its tip fit on the screen together, the tip under it. A part too tall for both (the
    // bid panel on a small phone) goes to the top of the screen, so its top — the countdown — is what's lit.
    const place = () => {
      const r = el.getBoundingClientRect();
      // Below the phone's top bar, which stays on the page: a part scrolled under it had its top hidden.
      const bar = document.querySelector("[data-top-bar]")?.getBoundingClientRect();
      const ceiling = bar && bar.height > 0 ? bar.bottom : 0;
      const room = window.innerHeight - ceiling;
      const block = r.height + PAD * 2 + GAP + cardHeight;
      const top = ceiling + (block + EDGE * 2 <= room ? (room - block) / 2 + PAD : EDGE + PAD);
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - top), behavior: "instant" });
      setRect(el.getBoundingClientRect());
    };
    place();
    const measure = () => setRect(el.getBoundingClientRect());
    window.addEventListener("resize", place);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, go, cardHeight]);

  // Each tip opens with its Next (or Done) in focus, unless focus is in it already: Safari doesn't focus a button it
  // clicks, so after a Next there it had gone back to the page.
  useEffect(() => {
    const card = cardRef.current;
    if (step === null || !rect || !card || card.contains(document.activeElement)) return;
    [...card.querySelectorAll<HTMLButtonElement>("button")].at(-1)?.focus({ preventScroll: true });
  }, [step, rect]);

  // The page holds still under the tour: no wheel, touch or key scrolls it, as with a dialog.
  const open = step !== null;
  useEffect(() => {
    if (!open) return;
    // Counted with the dialogs' and the palette's holds (`lockScroll`): the page scrolls again once the last one closes.
    const unlock = lockScroll();
    const hold = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", hold, { passive: false });
    window.addEventListener("touchmove", hold, { passive: false });
    return () => {
      unlock();
      window.removeEventListener("wheel", hold);
      window.removeEventListener("touchmove", hold);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return finish();
      const card = cardRef.current;
      if (e.key === "Tab" && card) {
        // Round the tip's own buttons, never out to the page behind it.
        e.preventDefault();
        const stops = [...card.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.disabled);
        nextStop(stops, document.activeElement instanceof HTMLButtonElement ? document.activeElement : null, e.shiftKey)?.focus();
      } else if (SCROLL_KEYS.has(e.key) && !(e.key === " " && e.target instanceof HTMLButtonElement)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (step === null || !rect) return null;
  const s = STEPS[step];
  // Under the part if the tip fits there, over it if it fits there, else at the foot of the screen with only the part
  // above it lit — never on top of what it's describing.
  const vh = window.innerHeight;
  const spotTop = rect.top - PAD;
  const spotBottom = rect.bottom + PAD;
  let spotHeight = spotBottom - spotTop;
  let cardTop: number;
  if (spotBottom + GAP + cardHeight + EDGE <= vh) cardTop = spotBottom + GAP;
  else if (spotTop - GAP - cardHeight >= EDGE) cardTop = spotTop - GAP - cardHeight;
  else {
    cardTop = Math.max(EDGE, vh - EDGE - cardHeight);
    spotHeight = Math.max(24, cardTop - GAP - spotTop);
  }
  const cardLeft = Math.min(Math.max(EDGE, rect.left), window.innerWidth - EDGE - Math.min(360, window.innerWidth - 2 * EDGE));
  const visibleSteps = STEPS.map((x, i) => i).filter((i) => shown(document.querySelector(STEPS[i].target)));
  const position = visibleSteps.indexOf(step) + 1;

  // At the end of <body>, as a dialog is: drawn inside the screen, it sat under the phone's top bar and tab bar.
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={s.title}>
      {/* The spotlight: the screen dimmed around the part the tip is about. */}
      <button type="button" aria-label="Skip the tour" tabIndex={-1} onClick={finish} className="absolute inset-0 cursor-default" />
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-xl transition-all duration-300"
        style={{ top: spotTop, left: rect.left - PAD, width: rect.width + PAD * 2, height: spotHeight, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)" }}
      />
      <div ref={cardRef} className="absolute w-[min(360px,calc(100vw-24px))] rounded-xl border border-hairline bg-surface-raised p-4 shadow-elevated-lg" style={{ top: cardTop, left: cardLeft }}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">{s.title}</h2>
          <span className="text-xs tabular-nums text-ink-faint">
            {position} of {visibleSteps.length}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={finish} className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Skip the tour
          </button>
          <div className="flex gap-2">
            {position > 1 && (
              <Button variant="ghost" className="!px-3 !py-1.5 text-sm" onClick={() => go(step - 1, -1)}>
                Back
              </Button>
            )}
            <Button className="!px-3 !py-1.5 text-sm" onClick={() => go(step + 1, 1)} autoFocus>
              {position === visibleSteps.length ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
