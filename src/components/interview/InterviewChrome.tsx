"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/components/interview/ChoiceStep";
import { Button } from "@/components/ui/Button";
import { FlightPathProgress } from "@/components/ui/FlightPathProgress";

/**
 * The step's continue button — and Enter, anywhere on the page that isn't a
 * text box, presses it. Only one step is on screen at a time, so only one
 * of these is ever listening.
 */
export function StepNav({ onNext, nextLabel, disabled }: { onNext: () => void; nextLabel: string; disabled?: boolean }) {
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  });
  useEffect(() => {
    if (disabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      // An answer option (a choice card, a number stop) with focus: Enter on
      // the one already picked continues — that's what the on-screen hint
      // promises right after clicking it — while Enter on another one just
      // picks it, the way a radio button normally behaves.
      if (target?.getAttribute("role") === "radio") {
        if (target.getAttribute("aria-checked") !== "true") return;
        e.preventDefault();
        onNextRef.current();
        return;
      }
      // Any other focused button handles its own Enter; a text box keeps Enter for typing.
      if (isTypingTarget(target) || target?.tagName === "BUTTON" || target?.tagName === "A") return;
      e.preventDefault();
      onNextRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);
  return (
    <div className="mt-10 flex items-center justify-end">
      <Button onClick={onNext} disabled={disabled} className="sm:min-w-[9rem] sm:px-6">
        {nextLabel}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5l5 5-5 5" />
        </svg>
      </Button>
    </div>
  );
}

/**
 * Progress drawn as the flight it is: from the brief to your ranking, the
 * aircraft moving along as you answer — with the honest readout underneath
 * (topics actually covered, a real estimate of time left).
 */
export function InterviewProgress({ fraction, left, right }: { fraction: number; left: string; right?: string }) {
  return (
    <div className="mb-6">
      <FlightPathProgress fraction={fraction} label="Interview progress" waypoints={3} />
      <div className="mt-1.5 flex items-center justify-between gap-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
        <span className="whitespace-nowrap">{left}</span>
        {right && <span className="whitespace-nowrap text-right">{right}</span>}
      </div>
    </div>
  );
}

