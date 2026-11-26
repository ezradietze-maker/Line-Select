import { NextResponse } from "next/server";
import { sendTestAlert } from "@/lib/server/alerts";
import { secretMatches } from "@/lib/server/secret";

export const runtime = "nodejs";

/**
 * Admin-only: sends a test failure alert to `ALERT_EMAIL` and a test error to PostHog's error tracking, and answers with
 * what happened to each — so the owner knows an outage would reach them before one does.
 *
 *   POST /api/admin/test-alert   (header x-admin-key)
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-admin-key"), process.env.ADMIN_API_KEY)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(await sendTestAlert(), { headers: { "Cache-Control": "no-store" } });
}
