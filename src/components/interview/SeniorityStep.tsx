"use client";

import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { resolveBidPosition } from "@/lib/forecast/forecast";
import type { SeniorityEntry } from "@/types/bidpack";

interface SeniorityStepProps {
  value: string;
  onChange: (value: string) => void;
  /** This seat's Bid Seniority List from the pack — numbers only. */
  list: SeniorityEntry[];
  seat: string;
  eyebrow?: string;
}

const PROMPT = "What’s your seniority number?";

/** A seniority number as typed: digits only, up to six. Null while empty or not a usable number. */
export function parseSeniorityInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 ? n : null;
}

/**
 * What a typed number says against the pack's list: found on it, not on it, or not a seniority number at all ("0").
 * Null while the box is empty, or when there's no list to check it against.
 */
export function checkSeniority(text: string, list: SeniorityEntry[]): { kind: "found" | "not-listed"; bidNumber: number } | { kind: "not-a-number" } | null {
  const typed = text.trim();
  if (!typed) return null;
  const n = parseSeniorityInput(typed);
  if (n === null) return { kind: "not-a-number" };
  if (!list.length) return null;
  const position = resolveBidPosition(list, n);
  return { kind: position.exact ? "found" : "not-listed", bidNumber: position.bidNumber };
}

/**
 * Under a seniority box, wherever it's asked (the interview, the quick start): found, or why the number won't do. A
 * "0" used to grey out Next with no reason, and the quick start dropped it, or saved a number not on the list, without
 * a word.
 */
export function SeniorityNotice({ value, list, seat, className = "" }: { value: string; list: SeniorityEntry[]; seat: string; className?: string }) {
  const check = checkSeniority(value, list);
  const seatWord = seat === "CAP" ? "captains" : "first officers";
  return (
    <div className={`text-sm ${className}`} aria-live="polite">
      {check?.kind === "found" && (
        <p className="rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-good">
          Found you: {ordinal(check.bidNumber)} in bid order of {list.length} {seatWord} bidding this month. {check.bidNumber - 1} bid ahead of you.
        </p>
      )}
      {check?.kind === "not-listed" && (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-warn">
          That number isn&rsquo;t on this pack&rsquo;s {seat === "CAP" ? "captain" : "first officer"} list. Check it, or continue and the estimate will place you by where it would fall
          {/* Past the end of the list, "about 782nd of 781" read as a mistake. */}
          {check.bidNumber > list.length ? <> (after all {list.length} on the list).</> : <> (about {ordinal(check.bidNumber)} of {list.length}).</>}
        </p>
      )}
      {check?.kind === "not-a-number" && (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-warn">Seniority numbers start at 1. Check the number, or leave it blank to skip it.</p>
      )}
    </div>
  );
}

export function SeniorityStep({ value, onChange, list, seat, eyebrow }: SeniorityStepProps) {
  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={PROMPT}
        help={
          <>
            Your bid pack lists every pilot bidding this seat, in bid order. Line Select uses only your place in that order to
            estimate which lines you could realistically hold. It never reads anyone&rsquo;s name or employee number.
          </>
        }
      />

      <RevealControls title={PROMPT} className="mt-8">
        <label htmlFor="seniority-number" className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
          Seniority number
        </label>
        <input
          id="seniority-number"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          placeholder="e.g. 1234"
          className="text-readout mt-2 block w-full max-w-56 rounded-xl border border-field-edge bg-canvas/60 px-4 py-3 text-2xl tracking-wider placeholder:text-ink-faint/60 focus:border-accent focus:shadow-[0_0_0_2px_var(--color-focus-ring),0_0_0_6px_var(--glow-soft)] focus:outline-none"
        />
        <SeniorityNotice value={value} list={list} seat={seat} className="mt-3 min-h-[3rem]" />

        <p className="mt-2 text-xs text-ink-faint">
          Prefer not to say? Leave it blank &mdash; you can add it any time on your Preferences page.
        </p>
      </RevealControls>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
