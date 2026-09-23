"use client";

import { useState } from "react";
import { buildLineCalendar } from "@/lib/ics-export";
import type { LineScore } from "@/lib/scoring";

type CopiedKind = "plain" | "annotated" | "shortlist" | null;

/** `rank` is the line's true position in the full ranking, not its index in `entries` — so a filtered export still shows real priority order (with gaps), not a renumbered subset. */
export interface BidOrderEntry {
  lineScore: LineScore;
  rank: number;
  /** The line's own specific facts (days off vs. your target, favorite cities…) — what "copy with notes" appends. Falls back to the model's one-sentence explanation. */
  note?: string;
}

export function BidOrderExport({
  entries,
  shortlistEntries = [],
  bidPeriodStart,
}: {
  entries: BidOrderEntry[];
  /** The starred lines, in ranked order — when present, "Copy shortlist" becomes the fastest way to turn a hand-picked set into a bid order. */
  shortlistEntries?: BidOrderEntry[];
  /** Threaded through to `buildLineCalendar` — the top pick's calendar export only works when the bid pack's own trip placement is real (see that function's own doc comment). */
  bidPeriodStart: string | null;
}) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  async function copy(text: string, kind: CopiedKind) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable — nothing to fall back to, just leave the buttons unchanged
    }
  }

  function downloadTopPickCalendar() {
    const topPick = entries[0];
    if (!topPick) return;
    const result = buildLineCalendar(topPick.lineScore.line, bidPeriodStart);
    if (!result.ok) {
      setCalendarError(result.reason ?? "Couldn't build a calendar file for this line.");
      setTimeout(() => setCalendarError(null), 4000);
      return;
    }
    const blob = new Blob([result.content!], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `line-${topPick.lineScore.line.lineNumber}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (entries.length === 0) return null;

  const secondary =
    "rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand";

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm font-medium text-ink">Ready to bid?</span>
        <button
          type="button"
          onClick={() => copy(entries.map((e) => e.lineScore.line.lineNumber).join("\n"), "plain")}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          {copied === "plain" ? "Copied" : "Copy line order"}
        </button>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className={`${secondary} sm:hidden`}
        >
          {showMore ? "Less" : "More"}
        </button>
        {shortlistEntries.length > 0 && (
          <button
            type="button"
            onClick={() => copy(shortlistEntries.map((e) => e.lineScore.line.lineNumber).join("\n"), "shortlist")}
            className={`${secondary} ${showMore ? "" : "hidden sm:inline-flex"}`}
          >
            {copied === "shortlist" ? "Copied" : `Copy shortlist (${shortlistEntries.length})`}
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            copy(
              entries
                .map((e) => `${e.rank}. Line ${e.lineScore.line.lineNumber} — ${e.note ?? e.lineScore.explanation}`)
                .join("\n"),
              "annotated"
            )
          }
          className={`${secondary} ${showMore ? "" : "hidden sm:inline-flex"}`}
        >
          {copied === "annotated" ? "Copied" : "Copy with notes"}
        </button>
        <button
          type="button"
          onClick={downloadTopPickCalendar}
          title="Downloads your top pick's real trips as a .ics file you can import into your device's calendar."
          className={`${secondary} ${showMore ? "" : "hidden sm:inline-flex"}`}
        >
          Add top pick to calendar
        </button>
      </div>
      <p className="mt-2 hidden text-xs leading-relaxed text-ink-faint sm:block">
        Line Select doesn&rsquo;t submit anything &mdash; copy your order, then enter it in your actual bid.
      </p>
      {calendarError && <p className="mt-2 text-xs text-danger">{calendarError}</p>}
    </div>
  );
}
