"use client";

import { useEffect } from "react";
import { installCrashReporting } from "@/lib/client-error-report";

/** Sends crashes in this browser to the owner's alerts (`lib/client-error-report.ts`). */
export function CrashReporting() {
  useEffect(() => installCrashReporting(), []);
  return null;
}
