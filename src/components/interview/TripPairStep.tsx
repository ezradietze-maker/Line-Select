"use client";

import { useMemo, useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { TripGlance } from "@/components/interview/TripGlance";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import { MAX_NOTE } from "@/lib/brain/answer-limits";
import type { TripPairCandidate } from "@/lib/brain/trip-pairs";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { TripChoice } from "@/types/pilot-model";

type Pick = { side: "a" | "b"; strength: TripChoice["strength"] } | { side: "tie" };

interface TripPairStepProps {
  prompt: string;
  helpText?: string;
  eyebrow?: string;
  pair: TripPairCandidate;
  bidPack: BidPack;
  /** The pilot's pick as a trip choice (null when they couldn't choose), and the answer in words for the interview record. */
  onAnswer: (choice: TripChoice | null, answer: string) => Promise<void>;
  onSkip: () => void;
}

/** How the two trips differ on the things the pilot has said matter — the better side of each row marked. */
function Differences({ pair }: { pair: TripPairCandidate }) {
  if (!pair.differences.length) return null;
  const cell = (on: boolean) => `px-3 py-2 text-right font-mono text-xs tabular-nums ${on ? "font-semibold text-accent" : "text-ink-muted"}`;
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-hairline">
      <table className="w-full text-left">
        <caption className="sr-only">
          How {pair.labelA} and {pair.labelB} differ on what you&rsquo;ve told us
        </caption>
        <thead>
          <tr className="border-b border-hairline bg-canvas/60">
            <th scope="col" className="px-3 py-2 font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] text-ink-faint">
              Where they differ
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] text-ink-faint">
              A
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] text-ink-faint">
              B
            </th>
          </tr>
        </thead>
        <tbody>
          {pair.differences.map((d) => (
            <tr key={d.label} className="border-b border-hairline last:border-0">
              <th scope="row" className="px-3 py-2 text-sm font-normal text-ink">
                {d.plain ? d.plain.charAt(0).toUpperCase() + d.plain.slice(1) : d.label}
              </th>
              {/* A feature said plainly ("less night flying") is ticked on the line that has it, not measured. */}
              <td className={cell(d.better === "a")}>
                {d.better === "a" && <span className="sr-only">better: </span>}
                {d.plain ? (d.better === "a" ? <span className="text-base leading-none">✓</span> : "") : d.a}
              </td>
              <td className={cell(d.better === "b")}>
                {d.better === "b" && <span className="sr-only">better: </span>}
                {d.plain ? (d.better === "b" ? <span className="text-base leading-none">✓</span> : "") : d.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Two real trips from the pilot's best lines that pull their priorities against each other — "which would you rather
 * fly?" — the way the ex-pilot asked to be shown: "give me actual trips to choose between". Each trip day by day, side
 * by side on a wide screen; the answer is a trip choice the trip weights learn from, with the why in their words.
 */
export function TripPairStep({ prompt, helpText, eyebrow, pair, bidPack, onAnswer, onSkip }: TripPairStepProps) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(bidPack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t])), [bidPack]);
  const tripA = byKey.get(pair.a);
  const tripB = byKey.get(pair.b);

  const options: { pick: Pick; label: string }[] = [
    { pick: { side: "a", strength: "strongly" }, label: "A, easily" },
    { pick: { side: "a", strength: "slightly" }, label: "A, just" },
    { pick: { side: "tie" }, label: "Can’t choose" },
    { pick: { side: "b", strength: "slightly" }, label: "B, just" },
    { pick: { side: "b", strength: "strongly" }, label: "B, easily" },
  ];
  const same = (a: Pick | null, b: Pick) => !!a && a.side === b.side && (a.side === "tie" || (b.side !== "tie" && a.strength === b.strength));

  async function submit() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    const note = why.trim() ? ` Why: ${why.trim()}` : "";
    try {
      if (pick.side === "tie") {
        await onAnswer(null, `Couldn't choose between ${pair.labelA} and ${pair.labelB} — about the same to me.${note}`);
      } else {
        const [preferred, other] = pick.side === "a" ? [pair.a, pair.b] : [pair.b, pair.a];
        const [better, worse] = pick.side === "a" ? [pair.labelA, pair.labelB] : [pair.labelB, pair.labelA];
        await onAnswer({ preferred, other, strength: pick.strength, ...(why.trim() ? { why: why.trim() } : {}) }, `I'd rather fly ${better} than ${worse} (${pick.strength === "strongly" ? "easily" : "just"}).${note}`);
      }
    } catch {
      setError("Couldn't send that — check your connection and try again.");
      setBusy(false);
    }
  }

  if (!tripA || !tripB) return null;
  const card = (side: "a" | "b", label: string, trip: NonNullable<typeof tripA>) => (
    <section aria-label={`Option ${side.toUpperCase()}: ${label}`} className={`min-w-0 rounded-xl border p-3.5 transition-colors ${pick?.side === side ? "border-brand/60 bg-brand-soft/30" : "border-border bg-surface"}`}>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">Option {side.toUpperCase()}</p>
      <p className="font-display text-lg font-semibold text-ink">{label}</p>
      <div className="mt-2">
        <TripGlance bidPack={bidPack} trip={trip} />
      </div>
    </section>
  );

  return (
    <div>
      <div className="max-w-3xl">
        <QuestionPrompt eyebrow={eyebrow} title={prompt} help={helpText ?? "Both trips day by day, just the trips, not the lines they're on."} />
      </div>
      <RevealControls title={prompt} className="mt-6">
        <div className="max-w-3xl">
          <Differences pair={pair} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {card("a", pair.labelA, tripA)}
          {card("b", pair.labelB, tripB)}
        </div>

        <p className="mt-5 text-sm font-medium text-ink">Which would you rather fly?</p>
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

        <NoteBox value={why} onChange={setWhy} placeholder="What decided it? (optional)" ariaLabel="What decided it" maxLength={MAX_NOTE} className="mt-4" />
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
