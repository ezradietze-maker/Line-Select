"use client";

import { useState } from "react";
import type { AutoBidEntry, FeasibilityTier } from "@/types/strategy";

const FEASIBILITY_DOT: Record<FeasibilityTier, string> = {
  strong: "bg-good",
  possible: "bg-accent",
  longshot: "bg-ink-faint",
};

export function AutoBidPanel({ entries }: { entries: AutoBidEntry[] }) {
  const [copied, setCopied] = useState(false);

  if (entries.length === 0) return null;

  async function handleCopy() {
    const text = entries.map((e) => `${e.rank}. Line ${e.lineNumber} — ${e.reason}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — nothing to fall back to, just leave the button unchanged
    }
  }

  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Your generated bid order</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            Every strategy&rsquo;s best real pick, blended into one list and ranked by true
            preference — not by odds. Rank your reaches first; nothing about seniority bidding
            punishes aiming high, since you fall through to the next choice automatically. This is
            a planning draft for you to transcribe into your actual bid — Line Select doesn&rsquo;t
            submit anything anywhere.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {copied ? "Copied" : "Copy list"}
        </button>
      </div>

      <ol className="mt-4 space-y-2">
        {entries.map((e) => (
          <li
            key={`${e.rank}-${e.lineNumber}`}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
              {e.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">Line {e.lineNumber}</span>
                <span className="text-xs text-ink-faint">{e.strategyName}</span>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${FEASIBILITY_DOT[e.feasibility]}`} aria-hidden />
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{e.reason}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
