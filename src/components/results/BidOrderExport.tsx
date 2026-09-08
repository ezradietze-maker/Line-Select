"use client";

import { useState } from "react";
import { buildLineCalendar } from "@/lib/ics-export";
import type { LineScore } from "@/lib/scoring";

type CopiedKind = "plain" | "annotated" | null;

/** `rank` is the line's true position in the full ranking, not its index in `entries` — so a filtered export still shows real priority order (with gaps), not a renumbered subset. */
export interface BidOrderEntry {
  lineScore: LineScore;
  rank: number;
}

export function BidOrderExport({
  entries,
  bidPeriodStart,
}: {
  entries: BidOrderEntry[];
  /** Threaded through to `buildLineCalendar` — the top pick's calendar export only works when the bid pack's own trip placement is real (see that function's own doc comment). */
  bidPeriodStart: string | null;
}) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);

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

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <p className="mr-auto min-w-[16rem] flex-1 text-xs leading-relaxed text-ink-faint">
        Ready to bid? Copy your ranked line numbers, in order, to paste or retype into your
        actual bid &mdash; Line Select doesn&rsquo;t submit anything anywhere.
        {calendarError && <span className="mt-1 block text-danger">{calendarError}</span>}
      </p>
      <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
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
          onClick={downloadTopPickCalendar}
          title="Downloads your top pick's real trips as a .ics file you can import into your device's calendar."
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          Add top pick to calendar
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
