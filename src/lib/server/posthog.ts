import { PostHog } from "posthog-node";

/**
 * The server-side half of the same PostHog project the browser reports
 * to (see `instrumentation-client.ts`) — used from `instrumentation.ts`'s
 * `onRequestError` hook to capture server errors, and from a handful of
 * call sites for aggregate usage events. `posthog-node` batches and
 * flushes on its own timer, which doesn't suit a serverless function that
 * can freeze right after responding — callers that need the event to
 * actually land use `captureExceptionImmediate`/`flush()` themselves
 * rather than relying on the background timer.
 *
 * A module-level singleton is safe here: Vercel reuses a warm serverless
 * instance across requests, and creating a fresh client per request would
 * mean never letting its batching do anything useful.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export const posthogServer = key ? new PostHog(key, { host }) : null;
