import type { Instrumentation } from "next";
import { posthogServer } from "@/lib/server/posthog";

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
    path: request.path,
    method: request.method,
  });
};
