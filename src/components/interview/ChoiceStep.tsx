"use client";

import { useEffect } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";

interface ChoiceStepProps {
  prompt: string;
  helpText?: string;
  eyebrow?: string;
  options: { label: string; description?: string }[];
  selected: number | null;
  onSelect: (index: number) => void;
  /** Rendered under the options — the optional "want to explain why?" box and the Next button. */
  children?: React.ReactNode;
}

/** True when a keystroke belongs to a text field rather than the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && !["range", "radio", "checkbox", "button"].includes((target as HTMLInputElement).type);
}

/**
 * A single-pick question. Each option carries its number, and pressing that
 * number picks it — quick for a pilot who'd rather not reach for the mouse —
 * except while they're typing in a text box.
 */
export function ChoiceStep({ prompt, helpText, eyebrow, options, selected, onSelect, children }: ChoiceStepProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        e.preventDefault();
        onSelect(n - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options.length, onSelect]);

  return (
    <div>
      <QuestionPrompt eyebrow={eyebrow} title={prompt} help={helpText} />
      <RevealControls title={prompt}>
        <div role="radiogroup" aria-label={prompt} className={`mt-8 grid gap-3 ${options.length > 2 ? "sm:grid-cols-2" : ""}`}>
          {options.map((opt, i) => {
            const isSelected = selected === i;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onSelect(i)}
                className={`group relative flex items-start gap-3.5 rounded-xl border p-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-panel)] ${
                  isSelected
                    ? "glow-soft border-accent bg-accent-soft/70"
                    : "border-hairline bg-surface/70 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold transition-colors ${
                    isSelected ? "border-accent bg-accent text-canvas" : "border-border-strong text-ink-faint group-hover:text-ink-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[15px] font-semibold ${isSelected ? "text-ink" : "text-ink"}`}>{opt.label}</span>
                  {opt.description && <span className="mt-0.5 block text-sm leading-snug text-ink-muted">{opt.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 hidden font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint sm:block" aria-hidden>
          Press 1&ndash;{options.length} to pick &middot; Enter to continue
        </p>
        {children}
      </RevealControls>
    </div>
  );
}
