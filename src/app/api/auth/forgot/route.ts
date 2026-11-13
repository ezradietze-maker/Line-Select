import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { requestPasswordResetEmail } from "@/lib/server/auth";
import { findCredentialByEmail } from "@/lib/server/db";
import { isEmailConfigured } from "@/lib/server/email";
import { incrementCounter } from "@/lib/server/kv";
import { checkRequestLimit, clientIp, deviceIdFrom, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

/** Whether email reset is available here — lets the sign-in screen offer it only when it will actually work. */
export async function GET() {
  return NextResponse.json({ emailEnabled: isEmailConfigured() });
}

export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const { ok } = await checkRequestLimit("auth-forgot", request, 10, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (!isText(body.email, 200)) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });

  if (!(await resetMailLeft(body.email))) return NextResponse.json({ emailEnabled: isEmailConfigured() });
  const emailEnabled = await requestPasswordResetEmail(body.email, clientIp(request), deviceIdFrom(request));
  return NextResponse.json({ emailEnabled });
}

/** Reset emails the whole site sends in an hour: well above what pilots really ask for, well below the email quota. */
const RESET_EMAILS_PER_HOUR = 20;

/**
 * Whether the site's hourly allowance of reset emails has room for this one. The limits per address and per account
 * still let one address mail every real account it knows about, about a hundred an hour, and that would spend the
 * email quota every reset (and every alert) depends on, so resets stopped for everyone. Only addresses with an account
 * are counted, the only ones mailed: made-up addresses can't use the hour up. Past the allowance the answer looks the
 * same as ever, so it says nothing about who has an account; the pilot asks again within the hour or uses their
 * recovery code. The send itself is in `requestPasswordResetEmail` (auth.ts); the count is here, before it.
 */
async function resetMailLeft(email: string): Promise<boolean> {
  if (!isEmailConfigured()) return true;
  try {
    if (!(await findCredentialByEmail(email.trim().toLowerCase()))) return true;
    const hour = new Date().toISOString().slice(0, 13);
    if ((await incrementCounter(`line-select:reset-mail:${hour}`, 2 * 60 * 60)) <= RESET_EMAILS_PER_HOUR) return true;
    console.error("[auth] hourly reset-email allowance reached", { hour });
    return false;
  } catch (e) {
    // Can't count: the send goes ahead, held by the limits per address and per account as before.
    console.error("[auth] reset-email allowance not checked", e);
    return true;
  }
}
