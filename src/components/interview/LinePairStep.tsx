"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import { ChevronDownIcon } from "@/components/ui/icons";
import { lineFigures } from "@/lib/brain/line-text";
import { buildPackRow, packColumnCount, packColumns, type PackColumn } from "@/lib/bidpack-row";
import { TripFold } from "@/components/interview/TripGlance";
import { BidPackHeader, BidPackStrip, StripKey, stripLayout, type StripLayout } from "@/components/results/BidPackStrip";
import { useMeasuredWidth } from "@/components/results/LegBars";
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

/**
 * One line as the results list shows it: the bid pack's own strip, the same days as the other line's right under it,
 * and tapped open, the full month calendar and its trips one by one — big enough for a pilot to read.
 */
function LineOption({
  bidPack,
  lineNumber,
  tag,
  columns,
  layout,
  selected,
  open,
  onToggle,
}: {
  bidPack: BidPack;
  lineNumber: string;
  tag: string;
  columns: PackColumn[];
  layout: StripLayout;
  selected: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const line = bidPack.lines.find((l) => l.lineNumber === lineNumber);
  const days = useMemo(() => (line ? buildPackRow(line, bidPack.bidPeriodStart, bidPack.bidPeriodDays, columns.length) : []), [line, bidPack, columns.length]);
  if (!line) return null;
  return (
    <section
      className={`panel-glass overflow-hidden transition-[border-color,box-shadow] ${selected ? "!border-brand ring-1 ring-brand/40" : "hover:!border-border-strong"}`}
      aria-label={`Option ${tag}: line ${lineNumber}`}
    >
      <BidPackStrip line={line} score={null} tag={tag} capped={false} columns={columns} view={{ kind: "pack", days }} layout={layout} grip={null} open={open} onToggle={onToggle} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="calendar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-hairline"
          >
            <div className="p-4 sm:p-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">Option {tag}</p>
              <p className="mt-0.5 font-display text-xl font-semibold text-ink">Line {lineNumber}</p>
              <p className="mb-3 font-mono text-xs text-ink-muted">{lineFigures(bidPack, line)}</p>
              <MiniLinePreview line={line} bidPeriodStart={bidPack.bidPeriodStart} bidPeriodDays={bidPack.bidPeriodDays} />
              <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">Its trips</p>
              <ul className="mt-2 space-y-2">
                {/* The same pairing can be flown twice in a month, so its id alone isn't a unique key. */}
                {line.trips.map((t, i) => (
                  <li key={`${t.id}-${i}`}>
                    <TripFold bidPack={bidPack} trip={t} />
                  </li>
                ))}
              </ul>
              <button type="button" onClick={onToggle} className="mt-4 inline-flex items-center gap-1 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
                Close line {lineNumber}&rsquo;s calendar
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  const [opened, setOpened] = useState<Set<"a" | "b">>(() => new Set());
  const toggle = (side: "a" | "b") =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (!next.delete(side)) next.add(side);
      return next;
    });
  // Both strips on the pack's day columns, laid out at the column's width, so each day of A sits over the same day of B.
  const columns = useMemo(() => packColumns(bidPack.bidPeriodStart, bidPack.bidPeriodDays, packColumnCount(bidPack)), [bidPack]);
  const [listRef, listWidth] = useMeasuredWidth<HTMLDivElement>(768);
  const layout = useMemo(() => stripLayout(listWidth, columns.length), [listWidth, columns.length]);

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
      <div className="max-w-3xl">
        <QuestionPrompt eyebrow={eyebrow} title={prompt} help={helpText ?? "Both lines as the bid pack prints them, day over day. Tap a line to open its full calendar."} />
      </div>
      <RevealControls title={prompt} className="mt-6">
        <div className="max-w-3xl">
          <Differences pair={pair} />
        </div>
        <StripKey view="pack" hint="Tap a line to open its calendar." className="mb-2" />
        <div ref={listRef} className="space-y-1.5">
          <BidPackHeader columns={columns} layout={layout} label="Line" sticky={false} />
          <LineOption bidPack={bidPack} lineNumber={pair.a} tag="A" columns={columns} layout={layout} selected={pick?.side === "a"} open={opened.has("a")} onToggle={() => toggle("a")} />
          <LineOption bidPack={bidPack} lineNumber={pair.b} tag="B" columns={columns} layout={layout} selected={pick?.side === "b"} open={opened.has("b")} onToggle={() => toggle("b")} />
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
