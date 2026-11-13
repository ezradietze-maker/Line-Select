import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { requestPasswordResetEmail } from "@/lib/server/auth";
import { findCredentialByEmail } from "@/lib/server/db";
import { isEmailConfigured } from "@/lib/server/email";
import { siteMailLeft } from "@/lib/server/mail-allowance";
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

/**
 * Whether the site's hourly allowance of reset emails (`siteMailLeft`) has room for this one. Only addresses with an
 * account are counted, the only ones mailed: made-up addresses can't use the hour up. Past the allowance the answer
 * looks the same as ever, so it says nothing about who has an account; the pilot asks again within the hour or uses
 * their recovery code. The send itself is in `requestPasswordResetEmail` (auth.ts); the count is here, before it.
 */
async function resetMailLeft(email: string): Promise<boolean> {
  if (!isEmailConfigured()) return true;
  try {
    if (!(await findCredentialByEmail(email.trim().toLowerCase()))) return true;
  } catch (e) {
    // Can't look: the send goes ahead, held by the limits per address and per account as before.
    console.error("[auth] reset-email allowance not checked", e);
    return true;
  }
  return siteMailLeft("reset");
}
