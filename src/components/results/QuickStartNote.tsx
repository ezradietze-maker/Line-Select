"use client";

import Link from "next/link";
import { useAppState } from "@/lib/app-state";
import { RESERVE_TYPE_LABEL, rankReserveLines } from "@/lib/reserve-rank";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/** What a quick brief's results owe the pilot: that it's a start, and where reserve and the catch-alls go. */
export function QuickStartNote({ bidPack, profile }: { bidPack: BidPack; profile: PreferenceProfile }) {
  const { handleStartInterview } = useAppState();
  if (profile.source !== "quick") return null;
  const reserve = rankReserveLines(bidPack, { model: profile.pilotModel, isCommuter: profile.isCommuter });
  return (
    <div className="mb-4 rounded-lg border border-hairline bg-canvas/60 px-4 py-3 text-sm leading-relaxed text-ink-muted print:hidden" data-quick-start-note>
      <p>
        <span className="font-medium text-ink">Quick start.</span> These come from the priorities you tapped. Drag a line up or down and we&rsquo;ll learn from it, or{" "}
        <button type="button" onClick={handleStartInterview} className="text-brand underline underline-offset-2">
          answer the full interview
        </button>{" "}
        to sharpen them. <Link href="/preferences" className="text-brand underline underline-offset-2">See your priorities</Link>.
      </p>
      {reserve.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">Your reserve lines, in your order</summary>
          <p className="mt-1">After your lines, your bid ends with any secondary line (9952), these reserve lines, then any reserve line (9954). Send to VIPS sets that up.</p>
          <ol className="mt-1 space-y-0.5">
            {reserve.map((l, i) => (
              <li key={l.lineNumber}>
                <span className="mr-1.5 font-mono text-ink-faint">{i + 1}.</span>
                <span className="font-mono text-ink">{l.lineNumber}</span>
                {l.reserveType ? ` ${RESERVE_TYPE_LABEL[l.reserveType]}` : ""}
                {l.reason ? ` · ${l.reason}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
