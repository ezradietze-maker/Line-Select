"use client";

import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { timezoneForAirport } from "@/lib/airport-timezones";
import {
  describeFinding,
  hhmm,
  lineBlockLimits,
  parseFlownSoFar,
  readHours,
  saveFlownSoFar,
  useFlownSoFarRaw,
  type FlownSoFar,
  type LimitFinding,
} from "@/lib/block-limits";
import type { BidPack } from "@/types/bidpack";

/** How many of the pilot's top lines the panel speaks for. */
const TOP = 20;

/** What the pilot has flown before this bid period, for every line's check. */
export function useFlownSoFar(packId: string): FlownSoFar {
  const raw = useFlownSoFarRaw(packId);
  return useMemo(() => parseFlownSoFar(raw), [raw]);
}

/** Each line's findings, by line id, for the pack as the pilot will fly it (carry-in and vacations already out). */
export function useBlockFindings(pack: BidPack, before: FlownSoFar): Map<string, LimitFinding[]> {
  return useMemo(() => new Map(pack.lines.map((l) => [l.id, lineBlockLimits(pack, l, before)])), [pack, before]);
}

/**
 * The flight-time limits in a few words, for "Your month"'s tab: lines in the pilot's top that go over (said as needing
 * them) or come close, else whether they've told us what they've flown.
 */
export function limitSummary(flownPack: BidPack, order: string[], before: FlownSoFar, findings: Map<string, LimitFinding[]>): { text: string; attention: boolean } {
  const byNumber = new Map(flownPack.lines.map((l) => [l.lineNumber, l]));
  const top = order.slice(0, TOP).flatMap((n) => {
    const line = byNumber.get(n);
    const fs = line ? findings.get(line.id) ?? [] : [];
    return fs.length ? [fs[0]] : [];
  });
  const over = top.filter((f) => f.level === "over").length;
  if (over) return { text: `${over} top line${over === 1 ? "" : "s"} over a limit`, attention: true };
  if (top.length) return { text: `${top.length} top line${top.length === 1 ? "" : "s"} close to a limit`, attention: false };
  return { text: before.monthHours === undefined ? "Not set" : "All clear", attention: false };
}

/**
 * The federal flight-time limits (14 CFR 121.471, 121.481) against each line, with what the pilot has flown before the
 * bid period: the 100 hours in a calendar month the period starts in needs their own count. Says only where a line goes
 * over or comes close; a line that stays clear isn't promised to, since only this pack's flying is known.
 */
export function BlockLimitsPanel({
  pack,
  flownPack,
  order,
  before,
  findings,
  bare = false,
}: {
  /** Inside "Your month"'s drawer: its frame, and opened, since the drawer was the click to see it. */
  bare?: boolean;
  pack: BidPack;
  /** The pack as the pilot will fly it, carry-in and vacations out: what the findings were worked from. */
  flownPack: BidPack;
  order: string[];
  before: FlownSoFar;
  findings: Map<string, LimitFinding[]>;
}) {
  const [open, setOpen] = useState(bare);
  const [monthText, setMonthText] = useState(() => (before.monthHours !== undefined ? hhmm(before.monthHours) : ""));
  const [yearText, setYearText] = useState(() => (before.yearHours !== undefined ? hhmm(before.yearHours) : ""));
  if (!pack.bidPeriodStart) return null;
  const zone = timezoneForAirport(pack.base) ?? "UTC";
  const start = DateTime.fromISO(pack.bidPeriodStart, { zone });
  const monthName = start.toFormat("LLLL");
  const startWords = start.toFormat("LLL d");

  const byNumber = new Map(flownPack.lines.map((l) => [l.lineNumber, l]));
  // A non-member's order is their ten (or a small pack's every line): "your top 20" would count lines it never checked.
  const topCount = order.length ? Math.min(TOP, order.length) : TOP;
  const top = order.slice(0, TOP).flatMap((n) => {
    const line = byNumber.get(n);
    const fs = line ? findings.get(line.id) ?? [] : [];
    return line && fs.length ? [{ number: n, finding: fs[0] }] : [];
  });
  const over = top.filter((t) => t.finding.level === "over");

  const save = (month: string, year: string) => {
    saveFlownSoFar(pack.id, { monthHours: readHours(month), yearHours: readHours(year) });
  };

  return (
    <section aria-label="Flight-time limits" className={`${bare ? "" : "panel-glass mt-4 p-4 sm:p-5 "}print:hidden`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Flight-time limits</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {over.length
              ? `${over.length} of your top ${topCount} lines would go over a federal limit.`
              : top.length
                ? `${top.length} of your top ${topCount} lines ${top.length === 1 ? "comes" : "come"} close to a federal limit.`
                : before.monthHours === undefined
                  ? `Add what you've flown in ${monthName} before ${startWords}, and your lines are checked against the 100-hour month.`
                  : `None of your top ${topCount} lines comes near a limit we can check.`}
          </p>
        </div>
        <Button variant="ghost" className="shrink-0 px-2 py-1 text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : before.monthHours === undefined ? "Add" : "Change"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-ink-muted">
              Block hours flown in {monthName} before {startWords}
              <input
                className={`${FIELD} mt-1 w-full`}
                inputMode="decimal"
                placeholder="e.g. 62:30"
                value={monthText}
                onChange={(e) => {
                  setMonthText(e.target.value);
                  save(e.target.value, yearText);
                }}
              />
            </label>
            <label className="block text-xs text-ink-muted">
              This year so far, before {startWords} (optional)
              <input
                className={`${FIELD} mt-1 w-full`}
                inputMode="decimal"
                placeholder="e.g. 640"
                value={yearText}
                onChange={(e) => {
                  setYearText(e.target.value);
                  save(monthText, e.target.value);
                }}
              />
            </label>
          </div>
          {top.length > 0 && (
            <ul className="space-y-1.5 text-sm text-ink">
              {top.map((t) => (
                <li key={t.number}>
                  <span className="font-medium">Line {t.number}</span>: {describeFinding(t.finding)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs leading-relaxed text-ink-faint">
            FedEx flies under 14 CFR Part 121: 100 block hours in a calendar month and 1,000 in a year, and 30 in any 7 days
            (32 on two-pilot international flying). Only flying you operate counts. Duties over 8 block hours have a relief
            pilot and their own limits, so a week or month with one isn&rsquo;t checked here. The rest of the month after
            this bid period is next month&rsquo;s line, so it isn&rsquo;t counted. Crew scheduling has the final say.
          </p>
        </div>
      )}
    </section>
  );
}

/** Under a line: where it goes over or comes close, in a sentence each. */
export function BlockLimitLineNote({ findings }: { findings: LimitFinding[] | undefined }) {
  if (!findings?.length) return null;
  return (
    <div className="mt-1 space-y-0.5 px-3 text-xs">
      {findings.map((f) => (
        <p key={`${f.kind}-${f.when}`} className={f.level === "over" ? "text-warn" : "text-ink-muted"}>
          Flight time: {describeFinding(f)}
        </p>
      ))}
    </div>
  );
}
