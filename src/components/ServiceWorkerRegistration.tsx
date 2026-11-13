"use client";

import { useEffect, useState } from "react";

/** Offline resilience is a nice-to-have, not a requirement — a failed or unsupported registration should never be user-visible. */
export function ServiceWorkerRegistration() {
  // Shown when the worker served the last visit's page on a slow link and the newer one has since arrived.
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "line-select:newer-page") setNewer(true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Production only: the worker serves Next's build files from its cache, and in development those keep their names
    // while their contents change — a cached one would be stale code. A worker left from before is removed there.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  if (!newer) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-hairline bg-panel px-4 py-2 text-sm text-ink shadow-lg md:bottom-6">
      <span>A newer version of Line Select is ready.</span>
      <button type="button" className="font-medium text-accent underline" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
