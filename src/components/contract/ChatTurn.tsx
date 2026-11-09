"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QuoteCard } from "@/components/contract/QuoteCard";
import { useTyped } from "@/components/contract/useTyped";
import { WorkingSteps } from "@/components/contract/WorkingSteps";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { ContractAnswer } from "@/lib/contract/types";

export interface Turn {
  id: string;
  question: string;
  steps: string[];
  answer: ContractAnswer | null;
  error: string | null;
  /** Asking again won't help: out of questions for today. */
  final?: boolean;
  /** Restored from this device: shown whole, nothing typed out again. */
  restored?: boolean;
}

function NotFound({ answer, onOpen }: { answer: Extract<ContractAnswer, { found: false }>; onOpen: (section: string) => void }) {
  return (
    <div className="animate-fade-in space-y-3">
      {answer.closest.length > 0 && (
        <div>
          <p className="text-sm text-ink-muted">The closest sections:</p>
          <ul className="mt-1 space-y-1">
            {answer.closest.map((c) => (
              <li key={c.section}>
                <button type="button" onClick={() => onOpen(c.section)} className="text-left text-sm text-accent underline-offset-2 hover:underline">
                  <span className="font-mono">{c.section}</span>
                  {c.path ? ` · ${c.path}` : ""} · p. {c.page}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm text-ink-muted">
        <summary className="cursor-pointer">What we have</summary>
        <p className="mt-2 leading-relaxed">
          The public 2026 agreement holds the parts the 2026 deal changed: {answer.covered.join("; ")}. Sections it left alone aren&apos;t in it, so the contract may still cover this.
        </p>
      </details>
    </div>
  );
}

function Reply({ answer, instant, onOpen, onTyped }: { answer: ContractAnswer; instant: boolean; onOpen: (section: string) => void; onTyped: () => void }) {
  const [typed, setTyped] = useState(instant);
  const onDone = useCallback(() => setTyped(true), []);
  // After the quotes have rendered, not as they're about to: the page has to be tall enough for the scroll to get there.
  useEffect(() => {
    if (typed) onTyped();
  }, [typed, onTyped]);
  const shown = useTyped(answer.answer, { totalMs: Math.min(2200, 500 + answer.answer.length * 6), instant, onDone });
  return (
    <div className="space-y-3">
      <p className={`text-base leading-relaxed ${answer.found ? "text-ink" : "font-medium text-ink"}`}>
        <span aria-hidden>
          {shown}
          {!typed && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-accent" />}
        </span>
        <span className="sr-only">{answer.answer}</span>
      </p>
      {typed &&
        (answer.found ? (
          <div className="animate-fade-in space-y-3">
            {answer.quotes.map((q, i) => (
              <QuoteCard key={`${q.section}-${i}`} quote={q} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <NotFound answer={answer} onOpen={onOpen} />
        ))}
    </div>
  );
}

interface ChatTurnProps {
  turn: Turn;
  lessMotion: boolean;
  onOpen: (section: string) => void;
  onRetry: (question: string) => void;
  /** The answer is all showing, and the quotes are about to come in under it. */
  onSettled: (turn: HTMLElement) => void;
}

/** One question and its reply: the working as it happens, then the checked answer typed out, then the quotes. */
export function ChatTurn({ turn, lessMotion, onOpen, onRetry, onSettled }: ChatTurnProps) {
  const instant = !!turn.restored || lessMotion;
  const [drained, setDrained] = useState(instant);
  const [showWorking, setShowWorking] = useState(false);
  const live = !turn.answer && !turn.error;
  const onDrained = useCallback(() => setDrained(true), []);
  const root = useRef<HTMLDivElement>(null);
  const restored = !!turn.restored;
  const onTyped = useCallback(() => {
    if (!restored && root.current) onSettled(root.current);
  }, [restored, onSettled]);

  return (
    <div ref={root} data-turn className="scroll-mt-20 space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent-soft px-4 py-2.5 text-sm leading-relaxed text-ink">{turn.question}</p>
      </div>

      <div className="space-y-3" aria-live="polite">
        {drained && turn.steps.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setShowWorking((v) => !v)}
              aria-expanded={showWorking}
              className="flex items-center gap-1 font-mono text-xs text-ink-faint transition-colors hover:text-ink-muted"
            >
              <ChevronDownIcon className={`h-3 w-3 transition-transform ${showWorking ? "" : "-rotate-90"}`} />
              {showWorking ? "Hide working" : "Show working"}
            </button>
            {showWorking && (
              <div className="mt-2">
                <WorkingSteps steps={turn.steps} live={false} instant />
              </div>
            )}
          </div>
        ) : (
          <WorkingSteps steps={turn.steps} live={live} instant={instant} onDrained={onDrained} />
        )}

        {turn.answer && drained && <Reply answer={turn.answer} instant={instant} onOpen={onOpen} onTyped={onTyped} />}
        {turn.error && drained && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-danger" role="alert">
            <span>{turn.error}</span>
            {!turn.final && (
              <button type="button" onClick={() => onRetry(turn.question)} className="text-accent underline-offset-2 hover:underline">
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
