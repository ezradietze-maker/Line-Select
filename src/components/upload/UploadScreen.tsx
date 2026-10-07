"use client";

import { useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Heading } from "@/components/ui/Heading";
import { NumberTicker } from "@/components/ui/NumberTicker";
import { FlightPlanLoader, type LoadProgress } from "@/components/upload/FlightPlanLoader";
import { MAX_PDF_BYTES } from "@/lib/pdf-parser/constants";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import { rankLayoverCitiesByFrequency } from "@/lib/scoring";
import { uploadBidPack } from "@/lib/upload-client";
import type { BidPack } from "@/types/bidpack";

interface UploadScreenProps {
  onParsed: (result: ParseBidPackResult) => void;
  onCancel?: () => void;
  /** The bid pack already loaded for this pilot, if any — shown as a
   * summary instead of jumping straight back to the dropzone every time
   * this screen is revisited. */
  currentBidPack?: BidPack | null;
  /** Loads a fabricated demo bid pack instead of parsing a real PDF — for anyone exploring without their own file handy. Omitted once a real bid pack is already loaded. */
  onTrySample?: () => void;
  /** Where a pilot with a pack already loaded goes next, and what that button says. */
  onContinue?: () => void;
  continueLabel?: string;
}

const MAX_MB = Math.round(MAX_PDF_BYTES / 1024 / 1024);
/** How long the "LOADED" lock-in holds before moving on — long enough to land, short enough not to stall anyone. */
const LOCK_IN_MS = 900;

export function UploadScreen({ onParsed, onCancel, currentBidPack, onTrySample, onContinue, continueLabel }: UploadScreenProps) {
  const reduce = useReducedMotion();
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<LoadProgress>({ received: false });
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (currentBidPack && !replacing) {
    return (
      <AlreadyUploaded
        bidPack={currentBidPack}
        onReplace={() => setReplacing(true)}
        onContinue={onContinue}
        continueLabel={continueLabel}
      />
    );
  }

  function validateFile(file: File): string | null {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return "That doesn't look like a PDF. Upload the bid pack PDF you downloaded.";
    if (file.size > MAX_PDF_BYTES) {
      return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — max supported size is ${MAX_MB}MB.`;
    }
    return null;
  }

  async function handleFile(file: File) {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setFileName(file.name);
    setProgress({ received: false });
    setLoaded(false);
    setUploading(true);

    try {
      const result = await uploadBidPack(file, (p) =>
        setProgress((prev) => {
          const next: LoadProgress = { ...prev, received: true };
          if (p.stage === "pages") next.pages = { done: p.done, total: p.total };
          if (p.stage === "pairings") next.pairings = p.pairings;
          if (p.stage === "lines") next.lines = p.lines;
          return next;
        })
      );
      // A pack that didn't really parse goes straight to its explanation —
      // never stamped "LOADED" first.
      if (result.errors.length > 0) {
        onParsed(result);
        return;
      }
      setProgress((prev) => ({ ...prev, received: true, lines: result.linesParsed, pairings: result.pairingsParsed }));
      setLoaded(true);
      window.setTimeout(() => onParsed(result), reduce ? 250 : LOCK_IN_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while uploading this file.");
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Step 1 &middot; Load</div>
      <Heading as="h1" className="mt-2 text-3xl text-ink sm:text-4xl">
        Load your bid pack
      </Heading>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
        The PDF for your base, aircraft, and month. Line Select reads the pairing schedules and line grids straight from
        it &mdash; nothing is typed in by hand.
      </p>

      <div className="mt-7">
        {uploading && fileName ? (
          <FlightPlanLoader fileName={fileName} progress={progress} loaded={loaded} />
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`panel-glass relative flex flex-col items-center justify-center overflow-hidden px-6 py-14 text-center transition-shadow duration-300 ${
              dragActive ? "glow-soft" : ""
            }`}
          >
            {/* The drop target's own edge — dashed at rest, lit when a file is over it. */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-3 rounded-[10px] border-2 border-dashed transition-colors duration-200 ${
                dragActive ? "border-accent" : "border-hairline"
              }`}
            />
            <div
              className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border border-hairline bg-surface-raised transition-transform duration-300 ${
                dragActive ? "-translate-y-1 scale-105 text-accent" : "text-ink-muted"
              }`}
              aria-hidden
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-8 w-8">
                <path strokeLinejoin="round" d="M6 3h8l4 4v14H6z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 17v-6m0 0l-2.5 2.5M12 11l2.5 2.5" />
              </svg>
            </div>
            {/* A phone has nothing to drag — it just picks the file. */}
            <p className="relative mt-5 font-display text-lg font-semibold text-ink [@media(pointer:coarse)]:hidden">
              {dragActive ? "Release to load it" : "Drop your bid pack PDF here"}
            </p>
            <p className="relative mt-5 hidden font-display text-lg font-semibold text-ink [@media(pointer:coarse)]:block">Pick your bid pack PDF</p>
            <p className="relative mt-1 text-sm text-ink-faint [@media(pointer:coarse)]:hidden">or</p>
            <Button type="button" variant="secondary" className="relative mt-3" onClick={() => inputRef.current?.click()}>
              Choose a file
            </Button>
            <p className="relative mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">PDF only &middot; up to {MAX_MB}MB</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

      {!uploading && (
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Parsed on our server and never stored there &mdash; only the extracted line data comes back to this device.
          Pages naming other pilots are never read.
        </p>
      )}

      {!uploading && (currentBidPack || onCancel) && (
        <button
          type="button"
          onClick={() => (currentBidPack ? setReplacing(false) : onCancel?.())}
          className="mt-6 text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          Back
        </button>
      )}

      {!uploading && !currentBidPack && onTrySample && (
        <button
          type="button"
          onClick={onTrySample}
          className="mt-6 block text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
        >
          Don&rsquo;t have a bid pack handy? Try it with sample data
        </button>
      )}
    </div>
  );
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatPeriod(start: string | null, days: number): string | null {
  if (!start) return null;
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(first.getTime() + (days - 1) * 86_400_000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(first)} – ${fmt(last)}`;
}

/** The pack a returning pilot already has loaded, read like a flight plan's header: what it is, what's in it, where it goes. */
function AlreadyUploaded({
  bidPack,
  onReplace,
  onContinue,
  continueLabel = "Continue",
}: {
  bidPack: BidPack;
  onReplace: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const stats = useMemo(() => {
    const n = Math.max(1, bidPack.lines.length);
    const cities = rankLayoverCitiesByFrequency(bidPack);
    const verified = bidPack.lines.filter((l) => !l.estimated);
    return {
      lines: bidPack.lines.length,
      avgDaysOff: bidPack.lines.reduce((s, l) => s + l.daysOff, 0) / n,
      avgCredit: bidPack.lines.reduce((s, l) => s + l.totalCreditHours, 0) / n,
      cityCount: cities.length,
      topCities: cities.slice(0, 10).map((c) => c.code),
      internationalPct: verified.length ? Math.round((verified.filter((l) => l.trips.some((t) => t.international)).length / verified.length) * 100) : null,
    };
  }, [bidPack]);
  const period = formatPeriod(bidPack.bidPeriodStart, bidPack.bidPeriodDays);

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Flight plan loaded</div>
      <Heading as="h1" className="mt-2 text-3xl text-ink sm:text-4xl">
        Your bid pack
      </Heading>

      <div className="panel-glass mt-6 overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-hairline p-6">
          <div>
            <div className="whitespace-nowrap font-display text-2xl font-semibold tracking-wide text-ink sm:text-4xl">
              {bidPack.base} <span className="text-ink-faint">&middot;</span> {bidPack.aircraft}{" "}
              <span className="text-ink-faint">&middot;</span> <span className="text-accent">{bidPack.seat}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              <span className="rounded border border-hairline px-1.5 py-0.5">{bidPack.month}</span>
              {period && <span>{period}</span>}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-good/40 bg-good-soft px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-good">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Ready
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4">
          {[
            ["Lines", <NumberTicker key="l" value={stats.lines} />],
            ["Avg days off", <NumberTicker key="d" value={stats.avgDaysOff} format={(v) => v.toFixed(1)} />],
            ["Avg credit", formatHours(stats.avgCredit)],
            ["Layover cities", <NumberTicker key="c" value={stats.cityCount} />],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-panel p-4">
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">{label}</dt>
              <dd className="text-readout mt-1 text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        {stats.topCities.length > 0 && (
          <div className="border-t border-hairline p-5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
              Most-flown layovers
              {stats.internationalPct !== null && <span> &middot; {stats.internationalPct}% of lines fly international</span>}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {stats.topCities.map((c, i) => (
                <span
                  key={c}
                  className={`rounded-md border px-2 py-1 font-mono text-xs ${
                    i < 3 ? "border-accent/40 bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                  }`}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
        <Button variant="secondary" onClick={onReplace}>
          Upload a different bid pack
        </Button>
        {onContinue && (
          <Button onClick={onContinue} className="sm:flex-1">
            {continueLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
