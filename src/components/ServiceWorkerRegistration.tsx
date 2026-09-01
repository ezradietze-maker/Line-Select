"use client";

import { useEffect } from "react";

/** Offline resilience is a nice-to-have, not a requirement — a failed or unsupported registration should never be user-visible. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
