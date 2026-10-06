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

export function SeniorityStep({ value, onChange, list, seat, eyebrow }: SeniorityStepProps) {
  const parsed = parseSeniorityInput(value);
  const position = parsed !== null ? resolveBidPosition(list, parsed) : null;
  const seatWord = seat === "CAP" ? "captains" : "first officers";

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
          className="text-readout mt-2 block w-56 rounded-xl border border-hairline bg-canvas/60 px-4 py-3 text-2xl tracking-wider placeholder:text-ink-faint/60 focus:border-accent focus:shadow-[0_0_0_4px_var(--glow-soft)] focus:outline-none"
        />
        <div className="mt-3 min-h-[3rem] text-sm" aria-live="polite">
          {position && position.exact && (
            <p className="rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-good">
              Found you: {ordinal(position.bidNumber)} in bid order of {list.length} {seatWord} bidding this month. {position.bidNumber - 1} bid ahead of you.
            </p>
          )}
          {position && !position.exact && (
            <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-warn">
              That number isn&rsquo;t on this pack&rsquo;s {seat === "CAP" ? "captain" : "first officer"} list. Check it, or continue and the estimate will place you by where it would fall (about {ordinal(position.bidNumber)} of {list.length}).
            </p>
          )}
        </div>

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
