/**
 * Crashes in a pilot's browser, sent to `/api/client-error` so they reach the owner like a server failure does. Only
 * the error itself and the page's path go — never what the pilot typed, their bid pack or a query string. Fails soft:
 * a report that can't be sent is just dropped.
 */

/** Errors that aren't the app's: browser extensions, a scrollbar settling, a cross-origin script with nothing to say, a request the page cancelled. */
const NOT_OURS = [/ResizeObserver loop/i, /^Script error\.?$/i, /AbortError|The user aborted a request|signal is aborted/i];
const EXTENSION = /(chrome|moz|safari(-web)?)-extension:\/\//;
/** An old page asking for a build file a new deploy removed: `app/error.tsx` reloads it, so it isn't a crash. */
const STALE_BUILD = /ChunkLoadError|Loading chunk|dynamically imported module/i;

/** A page that keeps failing reports its first few, not every one. */
const MAX_PER_PAGE = 5;
const sent = new Set<string>();

export function reportClientError(error: unknown, where: string): void {
  // Development's crashes are in the console already, and a half-saved file throws plenty.
  if (process.env.NODE_ENV !== "production") return;
  try {
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
    const message = `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}`.slice(0, 500);
    const stack = (e.stack ?? "").slice(0, 4_000);
    if (!e.message || NOT_OURS.some((r) => r.test(message)) || STALE_BUILD.test(message) || EXTENSION.test(stack)) return;
    if (sent.has(message) || sent.size >= MAX_PER_PAGE) return;
    sent.add(message);
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ message, stack, where, page: window.location.pathname }),
    }).catch(() => {});
  } catch {}
}

let installed = false;

/** Reports what no error screen catches: a throw in a button's handler, a promise that rejects with no one waiting. */
export function installCrashReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    // A failed image or script tag also fires here, with no error object: not a crash.
    if (event.error) reportClientError(event.error, "page");
  });
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, "promise"));
}
