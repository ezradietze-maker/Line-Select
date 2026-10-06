"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { fetchAwardHistory, submitAwardHistory, summarizeAwardHistory } from "@/lib/award-history";
import type { HoldHistorySummary } from "@/lib/learning/hold-history";
import { fetchHoldHistory } from "@/lib/learning/learning-client";
import type { BidPack } from "@/types/bidpack";
import type { AwardHistoryRecord, AwardHistorySubmission } from "@/types/award-history";
import type { UserAccount } from "@/types/auth";
import type { SeniorityInput } from "@/types/strategy";

type Outcome = "line" | "reserve" | "other";

interface AwardHistoryPanelProps {
  bidPack: BidPack;
  seniority: SeniorityInput;
  user: UserAccount | null;
  /** This pilot's own ranking of the pack's lines, best first — so a report can say which of their choices they got. */
  rankedLineIds?: string[];
}

export function AwardHistoryPanel({ bidPack, seniority, user, rankedLineIds }: AwardHistoryPanelProps) {
  const [records, setRecords] = useState<AwardHistoryRecord[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("line");
  const [lineId, setLineId] = useState(bidPack.lines[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HoldHistorySummary | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchHoldHistory().then((h) => {
      if (!cancelled) setHistory(h);
    });
    return () => {
      cancelled = true;
    };
  }, [user, historyVersion]);

  useEffect(() => {
    let cancelled = false;
    fetchAwardHistory(bidPack.base, bidPack.aircraft, bidPack.seat).then((data) => {
      if (!cancelled) setRecords(data);
    });
    return () => {
      cancelled = true;
    };
  }, [bidPack.base, bidPack.aircraft, bidPack.seat]);

  const summary = useMemo(
    () => (records ? summarizeAwardHistory(records, seniority) : null),
    [records, seniority]
  );

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    const selectedLine = outcome === "line" ? bidPack.lines.find((l) => l.id === lineId) : null;
    const choiceIndex = selectedLine && rankedLineIds ? rankedLineIds.indexOf(selectedLine.id) : -1;
    // The server stores whole numbers — a line's credit and TAFB hours are
    // usually fractional, which it would otherwise reject outright.
    const whole = (x: number | null | undefined) => (typeof x === "number" ? Math.round(x) : null);
    const submission: AwardHistorySubmission = {
      base: bidPack.base,
      aircraft: bidPack.aircraft,
      seat: bidPack.seat,
      month: bidPack.month,
      seniorityRank: seniority.rank,
      seniorityTotalPilots: seniority.totalPilots,
      outcome,
      lineNumber: selectedLine?.lineNumber ?? null,
      daysOff: whole(selectedLine?.daysOff),
      totalCreditHours: whole(selectedLine?.totalCreditHours),
      totalTafbHours: whole(selectedLine?.totalTafbHours),
      awardedChoice: choiceIndex >= 0 ? choiceIndex + 1 : null,
    };

    const result = await submitAwardHistory(submission);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setSubmitted(true);
    setFormOpen(false);
    setHistoryVersion((v) => v + 1);
    // Reflect the new report immediately rather than re-fetching.
    setRecords((prev) => [
      ...(prev ?? []),
      { ...submission, id: "local-pending", submittedAt: new Date().toISOString() },
    ]);
  }

  return (
    <div className="panel-glass p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">What pilots near you actually held</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            Real, self-reported outcomes for {bidPack.base} {bidPack.aircraft} {bidPack.seat} — no
            competitor has this data for FedEx specifically. Other pilots only ever see a
            seniority number and what was held, never your name. Your own reports also build
            your private month-by-month record below.
          </p>
        </div>
      </div>

      {summary === null ? (
        <Spinner label="Loading…" className="mt-4" />
      ) : summary.avgDaysOff === null ? (
        <EmptyState
          compact
          description={
            summary.nearbyCount === 0
              ? "No reports near your seniority yet — be the first."
              : `${summary.nearbyCount} nearby report${summary.nearbyCount === 1 ? "" : "s"} so far — not quite enough yet to show a reliable pattern.`
          }
          className="mt-4"
        />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Nearby reports" value={String(summary.nearbyCount)} />
          <Stat label="Avg days off held" value={summary.avgDaysOff.toFixed(1)} />
          <Stat label="Avg credit hours held" value={summary.avgCreditHours?.toFixed(1) ?? "—"} />
          {summary.lineRate !== null && (
            <Stat label="Held a regular line" value={`${Math.round(summary.lineRate * 100)}%`} />
          )}
        </div>
      )}

      {user && history && history.months > 0 && <HoldHistory history={history} />}

      <div className="mt-4 border-t border-hairline pt-4">
        {submitted ? (
          <p className="text-sm text-good">Thanks — your report was added.</p>
        ) : !user ? (
          <p className="text-sm text-ink-faint">Sign in to report what you held and help build this.</p>
        ) : !formOpen ? (
          <Button variant="secondary" onClick={() => setFormOpen(true)}>
            Report what you held
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(["line", "reserve", "other"] as Outcome[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    outcome === o
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border-strong text-ink-muted hover:border-brand hover:text-brand"
                  }`}
                >
                  {o === "line" ? "Held a regular line" : o === "reserve" ? "Held reserve" : "Something else"}
                </button>
              ))}
            </div>

            {outcome === "line" && (
              <select
                value={lineId}
                onChange={(e) => setLineId(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink"
              >
                {bidPack.lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    Line {line.lineNumber} &mdash; {line.daysOff} days off, {line.totalCreditHours.toFixed(1)} credit
                  </option>
                ))}
              </select>
            )}

            {error && <p className="text-xs text-danger">{error}</p>}

            <div className="flex gap-2">
              <Button
                onClick={handleSubmit}
                disabled={submitting || (outcome === "line" && !lineId)}
              >
                {submitting ? "Submitting…" : "Submit report"}
              </Button>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const pctLabel = (p: number) => `top ${Math.max(1, Math.round((1 - p) * 100))}%`;

/** This pilot's own awards, newest first — what they've really held, month after month. Only ever shown to them. */
function HoldHistory({ history }: { history: HoldHistorySummary }) {
  return (
    <div className="mt-5 rounded-lg border border-hairline bg-canvas/50 p-4">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">Your hold history</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">{history.headline}</p>
      {history.seniorityTrend && history.seniorityTrend.to !== history.seniorityTrend.from && (
        <p className="mt-1 text-xs text-ink-faint">
          Seniority: {pctLabel(history.seniorityTrend.from)} &rarr; {pctLabel(history.seniorityTrend.to)} of your list over that time.
        </p>
      )}
      <ul className="mt-3 divide-y divide-hairline">
        {history.records.slice(0, 12).map((r) => (
          <li key={`${r.month}-${r.base}-${r.aircraft}-${r.seat}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
            <span className="font-mono text-xs tabular-nums text-ink-muted">
              {r.month} &middot; {r.base} {r.aircraft} {r.seat}
            </span>
            <span className="text-ink">
              {r.outcome === "reserve"
                ? "Reserve"
                : r.outcome === "other"
                  ? "Something else"
                  : `Line${r.daysOff !== null ? ` · ${r.daysOff} off` : ""}${r.awardedChoice ? ` · your #${r.awardedChoice} choice` : ""}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas/50 px-3 py-2.5">
      <div className="font-mono text-lg font-semibold tabular-nums text-readout">{value}</div>
      <div className="text-xs text-ink-faint">{label}</div>
    </div>
  );
}
