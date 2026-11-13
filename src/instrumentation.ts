import type { Instrumentation } from "next";
import { assertProductionEnv } from "@/lib/server/env-assert";
import { posthogServer } from "@/lib/server/posthog";

/**
 * Runs once when a server instance starts, before it takes any request. On a
 * real production server this fails loudly if the environment that makes spend
 * caps, rate limits and persistence work is missing (`env-assert.ts`), so a
 * misconfigured deploy crashes at startup instead of serving a site whose
 * safeguards silently do nothing. Node runtime only — the Edge runtime fires
 * `register` too, but the stores this guards (Postgres, Redis) are only used
 * from Node, and the Edge build wouldn't carry those credentials.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") assertProductionEnv();
}

/**
 * Next.js's server-instrumentation hook (see node_modules/next/dist/docs/
 * 01-app/03-api-reference/03-file-conventions/instrumentation.md) — fires
 * for every server-side error (API routes, server components, server
 * actions) without needing a try/catch added to each one individually.
 * `captureExceptionImmediate` is awaited deliberately: a Vercel function
 * can freeze immediately after this returns, and posthog-node's normal
 * background batching wouldn't get a chance to actually send the event.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (!posthogServer) return;
  await posthogServer.captureExceptionImmediate(error, undefined, {
    // The path alone: a query can carry a reset link's token.
    path: request.path.split("?")[0],
    method: request.method,
  });
};
