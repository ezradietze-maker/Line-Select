"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Next.js App Router's segment error boundary — catches anything that
 * throws during rendering anywhere in the app instead of showing a blank
 * white screen. This is the last-resort safety net; `ErrorBoundary.tsx`
 * wraps specific risky sections (like each line card) so one bad line
 * doesn't have to take down the whole page and land here.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-elevated">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-danger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" d="M12 9v4m0 3h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This is a prototype and something broke unexpectedly. Your bid
          pack and preferences are still saved on this device &mdash; nothing
          was lost. Try again, and if it keeps happening, reloading the page
          or re-uploading your bid pack usually clears it.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button variant="secondary" onClick={() => (window.location.href = "/")}>
            Back to start
          </Button>
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
