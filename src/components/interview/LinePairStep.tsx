"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { MicButton } from "@/components/ui/MicButton";
import { tripDuties, tripHeadline } from "@/lib/brain/line-text";
import type { LinePairCandidate } from "@/lib/brain/interviewer";
import { useDictation } from "@/lib/use-speech-to-text";
import type { BidPack } from "@/types/bidpack";
import type { LineChoice } from "@/types/pilot-model";

type Pick = { side: "a" | "b"; strength: LineChoice["strength"] } | { side: "tie" };

interface LinePairStepProps {
  prompt: string;
  helpText?: string;
  eyebrow?: string;
  pair: LinePairCandidate;
  bidPack: BidPack;
  /** The pilot's pick as a choice (null when they couldn't choose), and the answer in words for the interview record. */
  onAnswer: (choice: LineChoice | null, answer: string) => Promise<void>;
  onSkip: () => void;
}

function LineDetail({ bidPack, lineNumber, label, selected }: { bidPack: BidPack; lineNumber: string; label: string; selected: boolean }) {
  const line = bidPack.lines.find((l) => l.lineNumber === lineNumber);
  if (!line) return null;
  return (
    <section
      className={`min-w-0 rounded-xl border p-4 transition-colors ${selected ? "border-brand bg-brand-soft/40" : "border-border bg-surface"}`}
      aria-label={`Line ${lineNumber}`}
    >
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className="mt-0.5 font-display text-xl font-semibold text-ink">Line {lineNumber}</p>
      <p className="font-mono text-xs text-ink-muted">
        {line.daysOff} days off · {line.totalCreditHours.toFixed(1)} credit · {line.trips.length} {line.trips.length === 1 ? "trip" : "trips"}
      </p>
      <ul className="mt-3 space-y-2">
        {line.trips.map((t) => (
          <li key={t.id}>
            <details className="group border-l-2 border-border-strong pl-2.5">
              <summary className="cursor-pointer list-none font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] marker:hidden">
                <span className="text-accent group-open:hidden" aria-hidden>▸ </span>
                <span className="hidden text-accent group-open:inline" aria-hidden>▾ </span>
                {tripHeadline(bidPack, t)}
              </summary>
              <ul className="mt-1.5 space-y-1 font-mono text-[11px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
                {tripDuties(t).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Two real lines from the pilot's own pack that pull their priorities
 * against each other — "which would you bid?" A choice between real lines
 * teaches how a pilot trades one thing for another better than any
 * description of it; the interview turns these choices into weights.
 */
export function LinePairStep({ prompt, helpText, eyebrow, pair, bidPack, onAnswer, onSkip }: LinePairStepProps) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation(why, setWhy);

  const options: { pick: Pick; label: string }[] = [
    { pick: { side: "a", strength: "strongly" }, label: `${pair.a}, easily` },
    { pick: { side: "a", strength: "slightly" }, label: `${pair.a}, just` },
    { pick: { side: "tie" }, label: "Can’t choose" },
    { pick: { side: "b", strength: "slightly" }, label: `${pair.b}, just` },
    { pick: { side: "b", strength: "strongly" }, label: `${pair.b}, easily` },
  ];
  const same = (a: Pick | null, b: Pick) => !!a && a.side === b.side && (a.side === "tie" || (b.side !== "tie" && a.strength === b.strength));

  async function submit() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    const note = why.trim() ? ` Why: ${why.trim()}` : "";
    try {
      if (pick.side === "tie") {
        await onAnswer(null, `Couldn't choose between line ${pair.a} and line ${pair.b} — about the same to me.${note}`);
      } else {
        const preferred = pick.side === "a" ? pair.a : pair.b;
        const other = pick.side === "a" ? pair.b : pair.a;
        await onAnswer({ preferred, other, strength: pick.strength, ...(why.trim() ? { why: why.trim() } : {}) }, `I'd bid line ${preferred} over line ${other} (${pick.strength === "strongly" ? "easily" : "just"}).${note}`);
      }
    } catch {
      setError("Couldn't send that — check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <QuestionPrompt eyebrow={eyebrow} title={prompt} help={helpText ?? "Tap a trip to see it duty by duty."} />
      <RevealControls title={prompt} className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <LineDetail bidPack={bidPack} lineNumber={pair.a} label="Option A" selected={pick?.side === "a"} />
          <LineDetail bidPack={bidPack} lineNumber={pair.b} label="Option B" selected={pick?.side === "b"} />
        </div>

        <p className="mt-5 text-sm font-medium text-ink">Which would you bid higher?</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5" role="group" aria-label="Your pick">
          {options.map((o) => {
            const on = same(pick, o.pick);
            return (
              <button
                key={o.label}
                type="button"
                aria-pressed={on}
                onClick={() => setPick(o.pick)}
                className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  o.pick.side === "tie" ? "col-span-2 sm:col-span-1" : ""
                } ${on ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong hover:text-ink"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <div className="relative mt-4">
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            rows={2}
            placeholder="What decided it? (optional)"
            aria-label="What decided it"
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 pr-11 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
          {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
        </div>
        {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={onSkip} disabled={busy} className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Skip this one
          </button>
          <Button type="button" onClick={submit} disabled={!pick || busy} className="sm:px-6">
            {busy ? "Sending…" : "Continue"}
          </Button>
        </div>
      </RevealControls>
    </div>
  );
}
