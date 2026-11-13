"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-report";
import { captureClientException } from "@/lib/posthog-client";

/**
 * The last safety net, for a crash in the root layout itself, where `error.tsx` can't help. It replaces the whole
 * document, without the site's styles (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * error.md), so it carries its own plain styling and follows the device's light or dark setting.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    captureClientException(error instanceof Error ? error : new Error(String(error)));
    reportClientError(error, "app");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", colorScheme: "light dark", padding: 24 }}>
        <title>Line Select — something went wrong</title>
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, opacity: 0.8 }}>Your bid pack and preferences are saved. Try again, and if it keeps happening, reload the page.</p>
          <button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "10px 18px", borderRadius: 4, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
