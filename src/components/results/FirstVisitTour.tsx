"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * A pilot's first look at the rankings: four tips, each lighting up the part of the screen it's about, once per
 * device. Skippable at any point; a tip whose part isn't on screen (the sidebar on a phone) is left out.
 */

const DONE_KEY = "line-select:tour:results:v1";

const STEPS: { target: string; title: string; body: string }[] = [
  { target: 'section[aria-label="This month\'s bid"]', title: "Your bid at a glance", body: "When bidding closes, counted down — and the month's bid step by step. Tick \"bid entered\" when you've put it in the bid system." },
  { target: 'section[aria-label="Ask your pack"]', title: "Ask your pack", body: "Ask in plain words — \"lines with Honolulu and no weekends worked\" — and get the pack's own lines back, with the figures behind each." },
  { target: '[id^="line-"]', title: "Your lines, best first", body: "Each line reads like the bid pack's own page. Tap one for its whole month. Ranked something wrong? Drag its handle onto another line to swap them — that teaches the ranking." },
  { target: '[role="group"][aria-label="Your flying"]', title: "Beyond this bid", body: "Your layover cities, your logbook of awards, and tools like the world clock and commute planner live here." },
];

function shown(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

export function FirstVisitTour({ ready }: { ready: boolean }) {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!ready) return;
    let done = true;
    try {
      done = window.localStorage.getItem(DONE_KEY) === "done";
    } catch {
      // No storage, no way to remember it was seen: better no tour than one on every visit.
    }
    if (done) return;
    const id = window.setTimeout(() => setStep(0), 1200);
    return () => window.clearTimeout(id);
  }, [ready]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(DONE_KEY, "done");
    } catch {
      // Nothing to remember it in.
    }
    setStep(null);
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

  useLayoutEffect(() => {
    if (step === null) return;
    const el = document.querySelector(STEPS[step].target);
    if (!shown(el)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      go(step + 1, 1);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "auto" });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, go]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, finish]);

  if (step === null || !rect) return null;
  const s = STEPS[step];
  const pad = 6;
  const below = rect.bottom + 180 < window.innerHeight;
  const cardTop = below ? rect.bottom + pad + 10 : Math.max(12, rect.top - pad - 10 - 170);
  const cardLeft = Math.min(Math.max(12, rect.left), window.innerWidth - 12 - Math.min(360, window.innerWidth - 24));
  const visibleSteps = STEPS.map((x, i) => i).filter((i) => shown(document.querySelector(STEPS[i].target)));
  const position = visibleSteps.indexOf(step) + 1;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={s.title}>
      {/* The spotlight: the screen dimmed around the part the tip is about. */}
      <button type="button" aria-label="Skip the tour" onClick={finish} className="absolute inset-0 cursor-default" />
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-xl transition-all duration-300"
        style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)" }}
      />
      <div className="absolute w-[min(360px,calc(100vw-24px))] rounded-xl border border-hairline bg-surface-raised p-4 shadow-elevated-lg" style={{ top: cardTop, left: cardLeft }}>
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
    </div>
  );
}
