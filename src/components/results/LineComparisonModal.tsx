"use client";

import { CircadianStars } from "@/components/results/CircadianStars";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import { Modal } from "@/components/ui/Modal";
import { computeCircadianAssessment } from "@/lib/circadian";
import type { LineScore } from "@/lib/scoring";

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
      <div className="text-ink-faint">{label}</div>
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
  onClose,
}: LineComparisonModalProps) {
  const worstCircadianStars = lineScores.map((ls) => {
    const stars = ls.line.trips
      .map((t) => computeCircadianAssessment(t, homeBaseOffsetMinutes))
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => a.stars);
    return stars.length > 0 ? Math.min(...stars) : null;
  });

  return (
    <Modal title="Compare lines" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-[120px_1fr_1fr] sm:text-sm">
        <div className="hidden sm:block" />
        {lineScores.map((ls) => (
          <div key={ls.line.id} className="text-center font-semibold text-ink">
            #{ls.line.lineNumber}
            <span className="ml-1 font-normal text-ink-faint">{ls.score}</span>
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
        <div className="text-ink-faint">Worst trip&rsquo;s circadian read</div>
        {worstCircadianStars.map((stars, i) => (
          <div key={i} className="flex justify-center">
            {stars !== null ? (
              <CircadianStars assessment={{ stars: stars as 1 | 2 | 3 | 4 | 5, timezoneShiftHours: 0, wocEncroachments: 0, shortRestCount: 0, summary: "" }} />
            ) : (
              <span className="text-ink-faint">—</span>
            )}
          </div>
        ))}
        <div className="text-ink-faint">Recovery across the month</div>
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
              />
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
