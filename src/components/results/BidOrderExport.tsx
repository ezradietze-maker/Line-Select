"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarSubscribe } from "@/components/results/CalendarSubscribe";
import { PlaneIcon } from "@/components/ui/icons";
import { SendToVipsDialog, type PresendContext } from "@/components/results/SendToVipsDialog";
import { buildLineCalendar } from "@/lib/ics-export";
import type { LineScore } from "@/lib/scoring";

type CopiedKind = "plain" | "annotated" | "shortlist" | null;

/** `rank` is the line's true position in the full ranking, not its index in `entries` — so an export with hidden or Not bid lines left out still shows real priority order (with gaps), not a renumbered subset. */
export interface BidOrderEntry {
  lineScore: LineScore;
  rank: number;
  /** The line's own specific facts (days off vs. your target, favorite cities…) — what "copy with notes" appends. Falls back to the model's one-sentence explanation. */
  note?: string;
}

const countLines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** What a copy button's new words say, for a screen reader: what went to the clipboard, and what was left out. */
function copiedSaying(kind: CopiedKind, lines: number, shortlisted: number, leftOut: number): string | null {
  const out = leftOut > 0 ? `, ${leftOut} left out` : "";
  if (kind === "plain") return leftOut > 0 ? `Line order copied: ${countLines(lines)}${out}` : "Line order copied — cleared to bid";
  if (kind === "annotated") return `Copied with notes: ${countLines(lines)}${out}`;
  if (kind === "shortlist") return `Shortlist copied: ${countLines(shortlisted)}`;
  return null;
}

/** A note shown for `ms`, then gone. Showing it again starts the clock over — an earlier timer never cuts the new one short. */
function useFlash<T>(ms: number): [T | null, (value: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (next: T | null) => {
    window.clearTimeout(timer.current);
    setValue(next);
    if (next !== null) timer.current = window.setTimeout(() => setValue(null), ms);
  };
  return [value, show];
}

export function BidOrderExport({
  entries,
  shortlistEntries = [],
  bidPeriodStart,
  bidMonth,
  packLabel,
  leftOut,
  leftOutWhy = null,
  presend,
  topLineNumber,
}: {
  entries: BidOrderEntry[];
  /** The starred lines, in ranked order — when present, "Copy shortlist" becomes the fastest way to turn a hand-picked set into a bid order. */
  shortlistEntries?: BidOrderEntry[];
  /** Threaded through to `buildLineCalendar` — the top pick's calendar export only works when the bid pack's own trip placement is real (see that function's own doc comment). */
  bidPeriodStart: string | null;
  /** The pack's month as printed ("NOV26"): each trip's calendar event is named by it, since line ids repeat every month. */
  bidMonth: string;
  /** e.g. "OCT26 · MEM · MD11 · FO" — shown in the VIPS dialog to check against VIPS's own "You are bidding as…". */
  packLabel: string;
  /** Lines in the pack that `entries` leaves out (hidden or Not bid) — the VIPS dialog warns they won't be bid. */
  leftOut: number;
  /** Which those are, in words ("the 2 lines you hid"): said under the buttons and on them once copied. */
  leftOutWhy?: string | null;
  /** What the VIPS dialog's checks read beyond the order. */
  presend: PresendContext;
  /** The pilot's #1, whatever the filters show: what their calendar link follows. */
  topLineNumber: string | null;
}) {
  const [copied, setCopied] = useFlash<NonNullable<CopiedKind>>(2000);
  const [calendarError, setCalendarError] = useFlash<string>(4000);
  const [vipsOpen, setVipsOpen] = useState(false);
  /** The first trip's date, shown on a little calendar page that flips over once the file has saved. */
  const [savedFrom, setSavedFrom] = useFlash<{ month: string; day: number }>(2800);
  const [showMore, setShowMore] = useState(false);

  async function copy(text: string, kind: CopiedKind) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      // clipboard unavailable — nothing to fall back to, just leave the buttons unchanged
    }
  }

  function downloadTopPickCalendar() {
    const topPick = entries[0];
    if (!topPick) return;
    const result = buildLineCalendar(topPick.lineScore.line, bidPeriodStart, bidMonth);
    if (!result.ok) {
      setCalendarError(result.reason ?? "Couldn't build a calendar file for this line.");
      return;
    }
    const blob = new Blob([result.content!], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `line-${topPick.lineScore.line.lineNumber}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    const firstDay = Math.min(...topPick.lineScore.line.trips.map((t) => t.startDayIndex ?? Infinity));
    if (bidPeriodStart && Number.isFinite(firstDay)) {
      const d = new Date(Date.parse(`${bidPeriodStart}T00:00:00Z`) + firstDay * 86_400_000);
      setSavedFrom({ month: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), day: d.getUTCDate() });
    }
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
          className="relative rounded-md bg-brand px-3 py-2 text-sm font-medium text-on-brand transition-colors hover:bg-brand-strong"
        >
          {copied === "plain" ? (
            <>
              {/* A plane climbing out of the button: the order's on its way to the bid system. */}
              <span aria-hidden className="climb-out pointer-events-none absolute -right-1 top-0">
                <PlaneIcon className="h-4 w-4 rotate-45" />
              </span>
              {/* "Cleared to bid" only for the whole pack: with lines left out, the button says how many went. */}
              {leftOut > 0 ? `Copied ${countLines(entries.length)} — ${leftOut} left out` : <>Copied &mdash; cleared to bid</>}
            </>
          ) : (
            "Copy line order"
          )}
        </button>
        <button
          type="button"
          onClick={() => setVipsOpen(true)}
          title="Opens VIPS in a new tab with this order filled in — you sign in and it's sent."
          className={secondary}
        >
          Send to VIPS
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
          {copied === "annotated" ? (leftOut > 0 ? `Copied ${countLines(entries.length)} — ${leftOut} left out` : "Copied") : "Copy with notes"}
        </button>
        <button
          type="button"
          onClick={downloadTopPickCalendar}
          title="Downloads your top pick's real trips as a .ics file you can import into your device's calendar."
          className={`${secondary} ${showMore ? "" : "hidden sm:inline-flex"} items-center gap-2`}
        >
          {savedFrom ? (
            <>
              {/* A page of the calendar flipping down to the first trip's day. */}
              <span aria-hidden className="calendar-flip inline-flex h-[22px] w-5 flex-col overflow-hidden rounded-[3px] border border-accent/60 bg-canvas text-center leading-none">
                <span className="bg-accent py-px font-mono text-[6.5px] font-semibold uppercase text-on-brand">{savedFrom.month}</span>
                <span className="flex flex-1 items-center justify-center font-mono text-[10px] font-semibold text-ink">{savedFrom.day}</span>
              </span>
              Saved &mdash; trips from {savedFrom.month} {savedFrom.day}
            </>
          ) : (
            "Add top pick to calendar"
          )}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          title="Prints the lines listed below, with their calendars — the controls are left off the page."
          className={`${secondary} hidden sm:inline-flex`}
        >
          Print
        </button>
      </div>
      <p className="mt-2 hidden text-xs leading-relaxed text-ink-faint sm:block">
        Send to VIPS opens pilot.fedex.com with this order filled in &mdash; you sign in there, and nothing is sent until you do. Or copy the order and enter it yourself.
      </p>
      {/* On a phone too: what's left out matters as much there. */}
      {leftOutWhy && (
        <p className="mt-2 text-xs leading-relaxed text-ink-muted" data-left-out>
          Copy and Send to VIPS take your whole ranked order, {countLines(entries.length)}, and leave out {leftOutWhy}.
        </p>
      )}
      {calendarError && <p className="mt-2 text-xs text-danger">{calendarError}</p>}
      {/* The buttons above change their words when they've worked; this says it out loud, since a changed label alone is silent. */}
      <span role="status" className="sr-only">
        {copiedSaying(copied, entries.length, shortlistEntries.length, leftOut) ??
          (savedFrom ? `Saved — trips from ${savedFrom.month} ${savedFrom.day}` : calendarError ?? "")}
      </span>
      <CalendarSubscribe topLineNumber={topLineNumber} />
      {vipsOpen && (
        <SendToVipsDialog
          lineNumbers={entries.map((e) => e.lineScore.line.lineNumber)}
          lineScores={entries.map((e) => e.lineScore)}
          packLabel={packLabel}
          leftOut={leftOut}
          presend={presend}
          onClose={() => setVipsOpen(false)}
        />
      )}
    </div>
  );
}
