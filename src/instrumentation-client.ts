import { loadPosthog, posthogConfigured, withPosthog } from "@/lib/posthog-loader";

/**
 * Next.js's `instrumentation-client` convention (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-
 * conventions/instrumentation-client.md). PostHog itself is started here —
 * but only once the page has gone idle, never ahead of hydration (see
 * `lib/posthog-loader.ts`). See Privacy Policy Section 12 for exactly what
 * this collects and doesn't: page views, a small number of named usage
 * events, and unhandled errors — never bid pack content, interview answers,
 * or preference facts, and no name/email are ever attached (see
 * `lib/posthog-client.ts` for where identify() is called).
 *
 * Silently does nothing without a key configured (e.g. local dev without
 * the env var set) — this is instrumentation, not a feature, and should
 * never be the thing that breaks the app.
 */
if (posthogConfigured && typeof window !== "undefined") {
  const start = () => void loadPosthog();
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 5000 });
  else window.setTimeout(start, 2000);
}

export function onRouterTransitionStart(url: string) {
  withPosthog((posthog) => posthog.capture("$pageview", { $current_url: url }));
}
