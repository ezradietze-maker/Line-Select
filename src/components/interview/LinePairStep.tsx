"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import { TripFold } from "@/components/interview/TripGlance";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import type { LinePairCandidate } from "@/lib/brain/interviewer";
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
      <div className="mt-3">
        <MiniLinePreview line={line} bidPeriodStart={bidPack.bidPeriodStart} bidPeriodDays={bidPack.bidPeriodDays} compact />
      </div>
      <ul className="mt-3 space-y-2">
        {/* The same pairing can be flown twice in a month, so its id alone isn't a unique key. */}
        {line.trips.map((t, i) => (
          <li key={`${t.id}-${i}`}>
            <TripFold bidPack={bidPack} trip={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How the two lines differ on the things the pilot has said matter — the better side of each row marked. */
function Differences({ pair }: { pair: LinePairCandidate }) {
  const rows = pair.differences ?? [];
  if (!rows.length) return null;
  const cell = (on: boolean) => `px-3 py-2 text-right font-mono text-xs tabular-nums ${on ? "font-semibold text-accent" : "text-ink-muted"}`;
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-hairline">
      <table className="w-full text-left">
        <caption className="sr-only">How Line {pair.a} and Line {pair.b} differ on what you&rsquo;ve told us</caption>
        <thead>
          <tr className="border-b border-hairline bg-canvas/60">
            <th scope="col" className="px-3 py-2 font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] text-ink-faint">
              Where they differ
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] text-ink-faint">
              {pair.a}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] text-ink-faint">
              {pair.b}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.label} className="border-b border-hairline last:border-0">
              <th scope="row" className="px-3 py-2 text-sm font-normal text-ink">
                {d.label}
              </th>
              <td className={cell(d.better === "a")}>
                {d.better === "a" && <span className="sr-only">better: </span>}
                {d.a}
              </td>
              <td className={cell(d.better === "b")}>
                {d.better === "b" && <span className="sr-only">better: </span>}
                {d.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <QuestionPrompt eyebrow={eyebrow} title={prompt} help={helpText ?? "Tap a day for everything on it, or a trip to see it day by day."} />
      <RevealControls title={prompt} className="mt-6">
        <Differences pair={pair} />
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

        <NoteBox
          value={why}
          onChange={setWhy}
          placeholder={pair.differences?.length ? "Which difference decided it? (optional)" : "What decided it? (optional)"}
          ariaLabel="What decided it"
          className="mt-4"
        />
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
