"use client";

import { useState } from "react";
import type { LineScore } from "@/lib/scoring";

type CopiedKind = "plain" | "annotated" | null;

/** `rank` is the line's true position in the full ranking, not its index in `entries` — so a filtered export still shows real priority order (with gaps), not a renumbered subset. */
export interface BidOrderEntry {
  lineScore: LineScore;
  rank: number;
}

export function BidOrderExport({ entries }: { entries: BidOrderEntry[] }) {
  const [copied, setCopied] = useState<CopiedKind>(null);

  async function copy(text: string, kind: CopiedKind) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable — nothing to fall back to, just leave the buttons unchanged
    }
  }

  if (entries.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <p className="mr-auto min-w-[16rem] flex-1 text-xs leading-relaxed text-ink-faint">
        Ready to bid? Copy your ranked line numbers, in order, to paste or retype into your
        actual bid &mdash; Line Select doesn&rsquo;t submit anything anywhere.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() =>
            copy(
              entries
                .map((e) => `${e.rank}. Line ${e.lineScore.line.lineNumber} — ${e.lineScore.explanation}`)
                .join("\n"),
              "annotated"
            )
          }
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {copied === "annotated" ? "Copied" : "Copy with notes"}
        </button>
        <button
          type="button"
          onClick={() => copy(entries.map((e) => e.lineScore.line.lineNumber).join("\n"), "plain")}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-strong"
        >
          {copied === "plain" ? "Copied" : "Copy line order"}
        </button>
      </div>
    </div>
  );
}
