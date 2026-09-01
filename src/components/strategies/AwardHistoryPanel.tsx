"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fetchAwardHistory, submitAwardHistory, summarizeAwardHistory } from "@/lib/award-history";
import type { BidPack } from "@/types/bidpack";
import type { AwardHistoryRecord, AwardHistorySubmission } from "@/types/award-history";
import type { UserAccount } from "@/types/auth";
import type { SeniorityInput } from "@/types/strategy";

type Outcome = "line" | "reserve" | "other";

interface AwardHistoryPanelProps {
  bidPack: BidPack;
  seniority: SeniorityInput;
  user: UserAccount | null;
}

export function AwardHistoryPanel({ bidPack, seniority, user }: AwardHistoryPanelProps) {
  const [records, setRecords] = useState<AwardHistoryRecord[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("line");
  const [lineId, setLineId] = useState(bidPack.lines[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const submission: AwardHistorySubmission = {
      base: bidPack.base,
      aircraft: bidPack.aircraft,
      seat: bidPack.seat,
      month: bidPack.month,
      seniorityRank: seniority.rank,
      seniorityTotalPilots: seniority.totalPilots,
      outcome,
      lineNumber: selectedLine?.lineNumber ?? null,
      daysOff: selectedLine?.daysOff ?? null,
      totalCreditHours: selectedLine?.totalCreditHours ?? null,
      totalTafbHours: selectedLine?.totalTafbHours ?? null,
    };

    const result = await submitAwardHistory(submission);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setSubmitted(true);
    setFormOpen(false);
    // Reflect the new report immediately rather than re-fetching.
    setRecords((prev) => [
      ...(prev ?? []),
      { ...submission, id: "local-pending", submittedAt: new Date().toISOString() },
    ]);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">What pilots near you actually held</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            Real, self-reported outcomes for {bidPack.base} {bidPack.aircraft} {bidPack.seat} — no
            competitor has this data for FedEx specifically. Anonymous: your report shares only
            your seniority number and what you held, never your name.
          </p>
        </div>
      </div>

      {summary === null ? (
        <p className="mt-4 text-sm text-ink-faint">Loading&hellip;</p>
      ) : summary.avgDaysOff === null ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-3.5 py-3 text-sm text-ink-faint">
          {summary.nearbyCount === 0
            ? "No reports near your seniority yet — be the first."
            : `${summary.nearbyCount} nearby report${summary.nearbyCount === 1 ? "" : "s"} so far — not quite enough yet to show a reliable pattern.`}
        </p>
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

      <div className="mt-4 border-t border-border pt-4">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-canvas px-3 py-2.5">
      <div className="text-lg font-semibold text-ink">{value}</div>
      <div className="text-xs text-ink-faint">{label}</div>
    </div>
  );
}
