import { NextResponse } from "next/server";
import { dailySummaryText, summarizeDay } from "@/lib/server/alerts";
import { missingEmailSettings, sendEmailExplained } from "@/lib/server/email";
import { secretMatches } from "@/lib/server/secret";

export const runtime = "nodejs";

/**
 * Admin-only: sends today's summary so far to `ALERT_EMAIL` right now, and answers with exactly what happened —
 * which settings are missing, or what Resend said — instead of waiting for the morning email to (not) arrive.
 *
 *   POST /api/admin/test-email   (header x-admin-key)
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-admin-key"), process.env.ADMIN_API_KEY)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const to = process.env.ALERT_EMAIL?.trim();
  if (!to) return NextResponse.json({ sent: false, reason: "ALERT_EMAIL isn't set", missing: ["ALERT_EMAIL", ...missingEmailSettings()] });
  const today = new Date().toISOString().slice(0, 10);
  const text = `This is a test from Line Select's alerts. If you can read it, the daily summary and alert emails will reach you.\n\n${dailySummaryText(await summarizeDay(today), null)}`;
  const result = await sendEmailExplained({ to, subject: "Line Select: test email", text });
  return NextResponse.json({ ...result, missing: missingEmailSettings() }, { headers: { "Cache-Control": "no-store" } });
}
