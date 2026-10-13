"use client";

import { useEffect } from "react";

/** Offline resilience is a nice-to-have, not a requirement — a failed or unsupported registration should never be user-visible. */
export function ServiceWorkerRegistration() {
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

  return null;
}
