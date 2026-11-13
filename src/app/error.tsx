"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { reportClientError } from "@/lib/client-error-report";
import { captureClientException } from "@/lib/posthog-client";

/**
 * Next.js App Router's segment error boundary — catches anything that
 * throws during rendering anywhere in the app instead of showing a blank
 * white screen. This is the last-resort safety net; `ErrorBoundary.tsx`
 * wraps specific risky sections (like each line card) so one bad line
 * doesn't have to take down the whole page and land here.
 */
const CHUNK_RELOAD_KEY = "line-select:chunk-reload:v1";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // A page from before a deploy (the offline copy, or a tab left open) asking for a build file the new deploy no
    // longer has: a fresh load fixes it, so do that once rather than show a crash. Once per tab, so a real outage
    // can't loop.
    if (error.name === "ChunkLoadError" || /Loading chunk|dynamically imported module/i.test(error.message)) {
      try {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
          window.location.reload();
          return;
        }
      } catch {
        // No storage, no guard against a loop: show the page below instead.
      }
    }
    console.error(error);
    captureClientException(error);
    reportClientError(error, "page");
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-[6px] border border-border-strong bg-surface p-6 text-center shadow-elevated">
        {/* A calm panel: the fasten-seatbelt sign on, and the plane flying level under it. Nothing moves. */}
        <svg viewBox="0 0 120 64" className="mx-auto h-16 w-[120px]" aria-hidden>
          <rect x={32} y={3} width={56} height={30} rx={3} fill="var(--color-on-sign)" stroke="var(--color-sign)" strokeWidth={1.5} />
          <g fill="var(--color-sign)" stroke="var(--color-sign)">
            {/* The seatbelt: two straps meeting at a buckle. */}
            <path d="M42 18 H55 M65 18 H78" fill="none" strokeWidth={3.2} />
            <rect x={54} y={13.5} width={12} height={9} rx={2} fill="none" strokeWidth={2} />
            <rect x={58} y={16.6} width={4} height={2.8} rx={0.6} stroke="none" />
          </g>
          <g transform="translate(60 50)">
            <g fill="var(--color-ink-muted)">
              <path transform="translate(-12 -12)" d="M21 12c0-.8-.7-1.2-1.6-1.2H15L10.3 3.6H8.5l2.3 7.2H6.2L4.6 8.6H3.2l1 3.4-1 3.4h1.4l1.6-2.2h4.6l-2.3 7.2h1.8l4.7-7.2h4.4c.9 0 1.6-.4 1.6-1.2z" />
            </g>
          </g>
          <path d="M14 50 h22 M84 50 h22" stroke="var(--color-border-strong)" strokeDasharray="3 4" />
        </svg>
        <h1 className="mt-4 text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This is a prototype and something broke unexpectedly. Nothing was
          lost &mdash; your bid pack and preferences are safe. Try again, and
          if it keeps happening, reloading the page or re-uploading your bid
          pack usually clears it.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          {/* A full page load on purpose: after a crash, a fresh start beats client-side navigation inside broken state. */}
          {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
          <Button variant="secondary" onClick={() => (window.location.href = "/")}>
            Back to start
          </Button>
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
