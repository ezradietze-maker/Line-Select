"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import type { BidPack } from "@/types/bidpack";

interface PreviewScreenProps {
  result: ParseBidPackResult;
  onConfirm: (bidPack: BidPack) => void;
  onUploadDifferent: () => void;
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export function PreviewScreen({ result, onConfirm, onUploadDifferent }: PreviewScreenProps) {
  const availableSeats = (["CAP", "FO"] as const).filter((s) => result.bidPacksBySeat[s]);
  const [selectedSeat, setSelectedSeat] = useState(availableSeats[0]);
  const [showDetails, setShowDetails] = useState(false);

  if (result.errors.length > 0) {
    return (
      <div className="mx-auto w-full max-w-xl animate-fade-in">
        <h1 className="text-2xl font-semibold text-ink sm:text-3xl">
          We couldn&rsquo;t read this bid pack
        </h1>
        <div className="mt-4 space-y-2">
          {result.errors.map((e, i) => (
            <div
              key={i}
              className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {e.message}
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Button onClick={onUploadDifferent}>Try a different file</Button>
        </div>
      </div>
    );
  }

  const pageCounts = result.pageClassifications.reduce(
    (acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const bidPack = selectedSeat ? result.bidPacksBySeat[selectedSeat] : undefined;
  const incompleteForSeat = result.linesWithIncompleteTrips.filter(
    (l) => l.seat === selectedSeat
  ).length;

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Does this look right?</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        We found <strong className="font-semibold text-ink">{result.linesParsed} lines</strong>{" "}
        from{" "}
        <strong className="font-semibold text-ink">
          {pageCounts["pairing-schedule"] ?? 0} pairing schedule pages
        </strong>{" "}
        in this PDF. Skimmed and skipped the rest &mdash; vacation, seniority, and training
        pages were never parsed.
      </p>

      {result.meta && (
        <div className="mt-6 grid grid-cols-3 gap-3 rounded-xl border border-border bg-surface p-5 text-center">
          <Stat label="Base" value={result.meta.base} />
          <Stat label="Aircraft" value={result.meta.aircraft} />
          <Stat label="Month" value={result.meta.month} />
        </div>
      )}

      {availableSeats.length > 1 && (
        <div className="mt-6">
          <div className="mb-2 text-sm font-medium text-ink">Which seat are you bidding?</div>
          <div className="grid grid-cols-2 gap-3">
            {availableSeats.map((seat) => (
              <button
                key={seat}
                type="button"
                onClick={() => setSelectedSeat(seat)}
                className={`rounded-lg border-2 p-4 text-left transition-colors ${
                  selectedSeat === seat
                    ? "border-brand bg-brand-soft"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                <div className="text-sm font-semibold text-ink">
                  {seat === "CAP" ? "Captain" : "First Officer"}
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  {result.bidPacksBySeat[seat]?.lines.length} lines
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {bidPack && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Lines" value={String(bidPack.lines.length)} />
            <Stat
              label="Avg credit"
              value={formatHours(
                bidPack.lines.reduce((s, l) => s + l.totalCreditHours, 0) / bidPack.lines.length
              )}
            />
            <Stat
              label="Avg days off"
              value={(
                bidPack.lines.reduce((s, l) => s + l.daysOff, 0) / bidPack.lines.length
              ).toFixed(1)}
            />
            <Stat
              label="Trip detail"
              value={`${bidPack.lines.length - incompleteForSeat}/${bidPack.lines.length}`}
            />
          </div>
          {incompleteForSeat > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              {incompleteForSeat} line{incompleteForSeat !== 1 ? "s" : ""} couldn&rsquo;t be
              matched to a specific pairing with full confidence. Their days off, credit, and
              TAFB totals are exact (read straight from the bid pack), but their trip-length,
              international, report-time, and deadhead scoring uses an estimate rather than a
              verified trip-by-trip breakdown.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowDetails((s) => !s)}
        className="mt-4 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
      >
        {showDetails ? "Hide parsing details" : "Show parsing details"}
      </button>

      {showDetails && (
        <div className="mt-3 rounded-lg border border-border bg-canvas p-4 text-xs text-ink-muted">
          <ul className="space-y-1">
            <li>Pairing schedule pages parsed: {pageCounts["pairing-schedule"] ?? 0}</li>
            <li>Line grid pages parsed: {pageCounts["line-grid"] ?? 0}</li>
            <li>
              Pages skipped (contain other pilots&rsquo; personal data, never read):{" "}
              {pageCounts["ignored-personal-data"] ?? 0}
            </li>
            <li>Other pages skipped (cover, info, sweep, etc.): {pageCounts["ignored-other"] ?? 0}</li>
            <li>Pairings parsed: {result.pairingsParsed}</li>
          </ul>
          {result.warnings.length > 0 && (
            <>
              <div className="mt-3 font-medium text-ink-muted">
                {result.warnings.length} parsing warning{result.warnings.length !== 1 ? "s" : ""}:
              </div>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                {result.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>
                    Page {w.pageNumber}: {w.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
        <Button variant="ghost" onClick={onUploadDifferent}>
          Upload a different file
        </Button>
        <Button
          className="sm:flex-1"
          disabled={!bidPack}
          onClick={() => bidPack && onConfirm(bidPack)}
        >
          Looks right &mdash; continue
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-lg font-semibold text-ink">{value}</div>
      <div className="text-xs text-ink-faint">{label}</div>
    </div>
  );
}
