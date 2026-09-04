"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { MAX_PDF_BYTES } from "@/lib/pdf-parser/constants";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
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
}

const MAX_MB = Math.round(MAX_PDF_BYTES / 1024 / 1024);

export function UploadScreen({ onParsed, onCancel, currentBidPack, onTrySample }: UploadScreenProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (currentBidPack && !replacing) {
    return (
      <AlreadyUploaded bidPack={currentBidPack} onReplace={() => setReplacing(true)} />
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
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-bidpack", { method: "POST", body: formData });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Something went wrong while uploading this file.");
        setUploading(false);
        return;
      }

      onParsed(body as ParseBidPackResult);
    } catch {
      setError("Couldn't reach the server to parse this file. Check your connection and try again.");
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
    <div className="mx-auto w-full max-w-xl animate-fade-in">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Upload your bid pack</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Upload the bid pack PDF for your base, aircraft, and month. Line Select reads the
        pairing schedule and line grid pages directly from it &mdash; nothing is typed in by
        hand.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`mt-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragActive ? "border-brand bg-brand-soft" : "border-border-strong bg-surface"
        }`}
      >
        {uploading ? (
          <>
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-brand"
              aria-hidden
            />
            <p className="mt-4 text-sm font-medium text-ink">Reading {fileName}&hellip;</p>
            <p className="mt-1 text-xs text-ink-faint">
              Parsing pairing schedules and line grids. This can take a moment for large bid
              packs.
            </p>
          </>
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-10 w-10 text-ink-faint"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
              />
            </svg>
            <p className="mt-4 text-sm font-medium text-ink">
              Drag your bid pack PDF here, or
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </Button>
            <p className="mt-3 text-xs text-ink-faint">PDF only, up to {MAX_MB}MB</p>
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
          </>
        )}
      </div>

      {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

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

function AlreadyUploaded({
  bidPack,
  onReplace,
}: {
  bidPack: BidPack;
  onReplace: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl animate-fade-in">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Your bid pack</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Already loaded and ready to score. Head to Preferences or My Rankings, or upload a
        different file if this isn&rsquo;t the one you meant to bid.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-ink">
              {bidPack.base} {bidPack.aircraft} {bidPack.seat}
            </div>
            <div className="mt-0.5 text-sm text-ink-muted">{bidPack.month}</div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-ink-faint">Lines</div>
            <div className="mt-0.5 font-mono font-semibold text-ink">{bidPack.lines.length}</div>
          </div>
          <div>
            <div className="text-ink-faint">Avg days off</div>
            <div className="mt-0.5 font-mono font-semibold text-ink">
              {(
                bidPack.lines.reduce((s, l) => s + l.daysOff, 0) / bidPack.lines.length
              ).toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-ink-faint">Avg credit</div>
            <div className="mt-0.5 font-mono font-semibold text-ink">
              {formatHours(
                bidPack.lines.reduce((s, l) => s + l.totalCreditHours, 0) / bidPack.lines.length
              )}
            </div>
          </div>
        </div>
      </div>

      <Button variant="secondary" onClick={onReplace} className="mt-6">
        Upload a different bid pack
      </Button>
    </div>
  );
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}
