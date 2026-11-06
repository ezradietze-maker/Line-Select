"use client";

import { useEffect, useState } from "react";

/** How long "back online" stays up once the connection returns. */
const BACK_MS = 2600;

/**
 * A small notice while the connection is down — a plane in airplane mode, and what still works (the pack and its
 * rankings live on this device; lookups wait) — then "back online" for a moment when it returns.
 */
export function OfflineNotice() {
  const [state, setState] = useState<"online" | "offline" | "back">("online");
  useEffect(() => {
    // Already offline when the page opened (the offline copy, from the service worker).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!navigator.onLine) setState("offline");
    const off = () => setState("offline");
    const on = () => setState((s) => (s === "offline" ? "back" : s));
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  useEffect(() => {
    if (state !== "back") return;
    const id = window.setTimeout(() => setState("online"), BACK_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--shell-bottom,0px)+1rem)] z-40 flex justify-center px-4">
      {state !== "online" && (
        <div key={state} className="animate-toast-in panel-glass flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-2 text-sm sm:rounded-full">
          <svg viewBox="0 0 24 24" fill="currentColor" className={`h-4 w-4 shrink-0 ${state === "offline" ? "text-warn" : "text-good"}`} aria-hidden>
            <path d="M21 12c0-.8-.7-1.2-1.6-1.2H15L10.3 3.6H8.5l2.3 7.2H6.2L4.6 8.6H3.2l1 3.4-1 3.4h1.4l1.6-2.2h4.6l-2.3 7.2h1.8l4.7-7.2h4.4c.9 0 1.6-.4 1.6-1.2z" />
          </svg>
          {state === "offline" ? (
            <span className="text-ink">
              <span className="font-medium">Flying offline</span>
              <span className="text-ink-muted"> &mdash; your pack and rankings still work here; lookups wait for a connection.</span>
            </span>
          ) : (
            <span className="font-medium text-ink">Back online</span>
          )}
        </div>
      )}
    </div>
  );
}
