"use client";

import { useEffect, useState } from "react";
import { useOffline } from "@/lib/connection";

/** How long "back online" stays up once the connection returns. */
const BACK_MS = 2600;

/**
 * A small notice while the connection is down — a plane in airplane mode, and what still works (the pack and its
 * rankings live on this device; lookups wait) — then "back online" for a moment when it returns.
 */
export function OfflineNotice() {
  // The app's own reading of the connection (`connection.ts`): it also catches a hotel's Wi-Fi with nothing behind it,
  // which the browser still calls online, and says "back" only once a request has really got through.
  const offline = useOffline();
  const [seen, setSeen] = useState(offline);
  const [back, setBack] = useState(false);
  // Coming back from offline shows "back online"; going offline clears it.
  if (offline !== seen) {
    setSeen(offline);
    setBack(!offline);
  }
  useEffect(() => {
    if (!back) return;
    const id = window.setTimeout(() => setBack(false), BACK_MS);
    return () => window.clearTimeout(id);
  }, [back]);
  const state = offline ? "offline" : back ? "back" : "online";

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--shell-bottom,0px)+1rem)] z-40 flex justify-center px-4">
      {state !== "online" && (
        <div key={state} className="animate-toast-in panel-glass flex max-w-md items-center gap-2.5 border-border-strong px-4 py-2 text-sm shadow-elevated-lg">
          <svg viewBox="0 0 24 24" fill="currentColor" className={`h-4 w-4 shrink-0 ${state === "offline" ? "text-warn" : "text-good"}`} aria-hidden>
            <path d="M21 12c0-.8-.7-1.2-1.6-1.2H15L10.3 3.6H8.5l2.3 7.2H6.2L4.6 8.6H3.2l1 3.4-1 3.4h1.4l1.6-2.2h4.6l-2.3 7.2h1.8l4.7-7.2h4.4c.9 0 1.6-.4 1.6-1.2z" />
          </svg>
          {state === "offline" ? (
            <span className="text-ink">
              <span className="font-medium">Flying offline</span>
              <span className="text-ink-muted"> &mdash; your pack, rankings, calendar and logbook still work here; the interview waits for a connection.</span>
            </span>
          ) : (
            <span className="font-medium text-ink">Back online</span>
          )}
        </div>
      )}
    </div>
  );
}
