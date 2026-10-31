"use client";

import { bodyClockTone } from "@/components/results/BodyClock";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import { Modal } from "@/components/ui/Modal";
import { lineBodyClockScore, tripBodyClockScore } from "@/lib/body-clock-score";
import { lineDutyPeriods } from "@/lib/duty-periods";
import type { LineScore } from "@/lib/scoring";
import type { MonthDepartureOptions } from "@/lib/month-detail";
import type { CityMark } from "@/types/preferences";

/**
 * Two lines' month calendars side by side, instead of holding one in memory
 * while scrolling back to compare it against another — the mini calendar's
 * whole reason for existing (a compact, at-a-glance read of a line's shape)
 * only really pays off once a pilot can put two of them next to each other.
 */

interface LineComparisonModalProps {
  lineScores: [LineScore, LineScore];
  homeBaseOffsetMinutes: number | null;
  bidPeriodStart: string | null;
  bidPeriodDays: number;
  /** The pilot's loved/avoided layover cities, so each calendar can say how they feel about a layover. */
  cityPreferences?: Record<string, CityMark>;
  departureOptions?: MonthDepartureOptions;
  onClose: () => void;
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function StatRow({ label, values }: { label: string; values: [string, string] }) {
  return (
    <>
      {/* On a phone the label takes its own row above the two values — three items in a two-column grid otherwise interleave labels and numbers. */}
      <div className="col-span-2 border-t border-hairline pt-1.5 text-ink-faint sm:col-span-1 sm:border-0 sm:pt-0">{label}</div>
      <div className="text-center font-mono text-ink">{values[0]}</div>
      <div className="text-center font-mono text-ink">{values[1]}</div>
    </>
  );
}

export function LineComparisonModal({
  lineScores,
  homeBaseOffsetMinutes,
  bidPeriodStart,
  bidPeriodDays,
  cityPreferences,
  departureOptions,
  onClose,
}: LineComparisonModalProps) {
  // Each line's body-clock score, and its hardest trip's — 1–100, 100 the gentlest.
  const bodyClocks = lineScores.map((ls) => {
    const trips = ls.line.trips.map((t) => tripBodyClockScore(t, homeBaseOffsetMinutes)?.score).filter((s): s is number => s !== undefined);
    return { line: lineBodyClockScore(ls.line.trips, homeBaseOffsetMinutes)?.score ?? null, hardest: trips.length ? Math.min(...trips) : null };
  });
  const scoreCell = (score: number | null, i: number) => (
    <div key={i} className="text-center font-mono">
      {score !== null ? (
        <span className={`font-semibold ${bodyClockTone(score)}`}>
          {score}
          <span className="font-normal text-ink-faint">/100</span>
        </span>
      ) : (
        <span className="text-ink-faint">—</span>
      )}
    </div>
  );

  return (
    <Modal title="Compare lines" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-[120px_1fr_1fr] sm:text-sm">
        <div className="hidden sm:block" />
        {lineScores.map((ls) => (
          <div key={ls.line.id} className="text-center font-semibold text-ink">
            #{ls.line.lineNumber}
            <span className="ml-1 font-normal text-ink-faint">{Math.round(ls.score)}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4 gap-y-1.5 text-xs sm:grid-cols-[120px_1fr_1fr]">
        <StatRow label="Days off" values={[String(lineScores[0].line.daysOff), String(lineScores[1].line.daysOff)]} />
        <StatRow
          label="Credit"
          values={[formatHours(lineScores[0].line.totalCreditHours), formatHours(lineScores[1].line.totalCreditHours)]}
        />
        <StatRow
          label="TAFB"
          values={[formatHours(lineScores[0].line.totalTafbHours), formatHours(lineScores[1].line.totalTafbHours)]}
        />
        <StatRow label="Landings" values={[String(lineScores[0].line.totalLandings), String(lineScores[1].line.totalLandings)]} />
        <StatRow label="Duty periods" values={[String(lineDutyPeriods(lineScores[0].line)), String(lineDutyPeriods(lineScores[1].line))]} />
        <div className="col-span-2 border-t border-hairline pt-1.5 text-ink-faint sm:col-span-1 sm:border-0 sm:pt-0">Body clock</div>
        {bodyClocks.map((b, i) => scoreCell(b.line, i))}
        <div className="col-span-2 border-t border-hairline pt-1.5 text-ink-faint sm:col-span-1 sm:border-0 sm:pt-0">Hardest trip on the body clock</div>
        {bodyClocks.map((b, i) => scoreCell(b.hardest, i))}
        <div className="col-span-2 border-t border-hairline pt-1.5 text-ink-faint sm:col-span-1 sm:border-0 sm:pt-0">Recovery across the month</div>
        {lineScores.map((ls) => (
          <div key={ls.line.id} className={`text-center text-[11px] leading-tight ${ls.cumulativeCircadian?.hasCompoundingRisk ? "text-warn" : "text-ink-muted"}`}>
            {ls.cumulativeCircadian?.summary ?? "Not confirmable"}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        {lineScores.map((ls) =>
          ls.estimated ? (
            <div key={ls.line.id} className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              Line {ls.line.lineNumber}&rsquo;s trip shape is estimated — no verified calendar to compare visually.
            </div>
          ) : (
            <div key={ls.line.id}>
              <div className="mb-1.5 text-xs font-semibold text-ink">Line {ls.line.lineNumber}</div>
              <MiniLinePreview
                line={ls.line}
                homeBaseOffsetMinutes={homeBaseOffsetMinutes}
                bidPeriodStart={bidPeriodStart}
                bidPeriodDays={bidPeriodDays}
                cityPreferences={cityPreferences}
                departureOptions={departureOptions}
              />
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
