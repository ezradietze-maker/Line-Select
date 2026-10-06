"use client";

import { CopyButton } from "@/components/ui/CopyButton";
import type { AutoBidEntry, FeasibilityTier } from "@/types/strategy";

const FEASIBILITY_DOT: Record<FeasibilityTier, string> = {
  strong: "bg-good shadow-[0_0_6px_var(--color-good)]",
  possible: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
  longshot: "bg-ink-faint",
};

const FEASIBILITY_WORD: Record<FeasibilityTier, string> = {
  strong: "Strong odds",
  possible: "Possible",
  longshot: "Long shot",
};

export function AutoBidPanel({ entries, onGoToResults }: { entries: AutoBidEntry[]; onGoToResults?: () => void }) {
  if (entries.length === 0) return null;

  return (
    <section className="panel-glass glow-soft overflow-hidden" aria-labelledby="autobid-title">
      <div className="border-b border-hairline bg-gradient-to-r from-accent-soft/70 to-transparent px-5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent sm:px-6">
        Your bid order
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 id="autobid-title" className="font-display text-xl font-semibold text-ink">
              Your seniority-aware bid order
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Reaches first, safe picks last &mdash; built from what you can realistically hold at your seniority.
              Aiming high costs nothing: if a reach doesn&rsquo;t land, you fall through to the next line.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              <span className="font-medium text-ink">Which list do I bid?</span> This one accounts for seniority.
              {onGoToResults ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onGoToResults}
                    className="font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-ink"
                  >
                    My Rankings
                  </button>
                </>
              ) : (
                " Your rankings page"
              )}{" "}
              orders every line purely by how well it fits you. Either works &mdash; Line Select doesn&rsquo;t submit
              anything, so copy the one you want and enter it in your actual bid.
            </p>
          </div>
          <CopyButton
            label="Copy list"
            getText={() => entries.map((e) => `${e.rank}. Line ${e.lineNumber} — ${e.reason}`).join("\n")}
          />
        </div>

        <ol className="mt-5 overflow-hidden rounded-lg border border-hairline">
          {entries.map((e) => (
            <li
              key={`${e.rank}-${e.lineNumber}`}
              className="flex items-start gap-3 border-b border-hairline bg-canvas/30 px-3.5 py-2.5 last:border-b-0 sm:gap-4"
            >
              <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-accent">{e.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono text-sm font-semibold text-ink">Line {e.lineNumber}</span>
                  <span className="text-xs text-ink-faint">{e.strategyName}</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{e.reason}</p>
              </div>
              <span className="mt-1 flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint" title={FEASIBILITY_WORD[e.feasibility]}>
                <span className={`h-1.5 w-1.5 rounded-full ${FEASIBILITY_DOT[e.feasibility]}`} aria-hidden />
                <span className="hidden sm:inline">{FEASIBILITY_WORD[e.feasibility]}</span>
                <span className="sr-only sm:hidden">{FEASIBILITY_WORD[e.feasibility]}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
