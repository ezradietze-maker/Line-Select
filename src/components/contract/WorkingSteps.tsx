"use client";

import { useEffect, useState } from "react";
import { useTyped } from "@/components/contract/useTyped";

const LINE_MS = 380;
/** Each finished line stays a moment before the next starts, so a search that takes milliseconds can still be read. */
const HOLD_MS = 140;

function Tick({ working }: { working: boolean }) {
  return working ? (
    <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-[1px] bg-accent" />
  ) : (
    <span aria-hidden className="mt-[1px] w-2 shrink-0 text-center text-accent">
      ✓
    </span>
  );
}

function TypedLine({ text, instant, onDone }: { text: string; instant: boolean; onDone: () => void }) {
  const shown = useTyped(text, { totalMs: LINE_MS, instant, onDone });
  return (
    <>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}

interface WorkingStepsProps {
  /** What the server has really done so far, in order. */
  steps: string[];
  /** The server is still working, so the last line is what's happening now. */
  live: boolean;
  instant: boolean;
  /** Every step has been shown and the server has finished. */
  onDrained?: () => void;
}

/** The chat's working, one line at a time as it happens. */
export function WorkingSteps({ steps, live, instant, onDrained }: WorkingStepsProps) {
  const [shown, setShown] = useState(0);
  const typedAll = instant || shown >= steps.length;

  useEffect(() => {
    if (typedAll && !live) onDrained?.();
  }, [typedAll, live, onDrained]);

  const lines = instant ? steps : steps.slice(0, shown + 1);
  return (
    <ol className="space-y-1 font-mono text-xs leading-relaxed text-ink-muted" aria-label="What it's doing">
      {lines.map((text, i) => {
        const typing = !instant && i === shown;
        const current = live && i === steps.length - 1 && !typing;
        return (
          <li key={i} className="flex gap-2">
            <Tick working={typing || current} />
            <span className="min-w-0">{typing ? <TypedLine text={text} instant={false} onDone={() => setTimeout(() => setShown(i + 1), HOLD_MS)} /> : text}</span>
          </li>
        );
      })}
    </ol>
  );
}
