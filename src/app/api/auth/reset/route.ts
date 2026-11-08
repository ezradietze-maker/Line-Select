import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { SESSION_COOKIE, resetPasswordWithRecoveryCode, sessionCookieOptions } from "@/lib/server/auth";
import { checkRequestLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

// resetPasswordWithRecoveryCode() rate-limits per email (like login does);
// this per-IP layer additionally stops one address from working through many
// different emails.
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const { ok } = await checkRequestLimit("auth-reset", request, 20, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { email?: string; recoveryCode?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const { email, recoveryCode, newPassword } = body;
  if (!isText(email, 200) || !isText(recoveryCode, 100) || !isText(newPassword, 500)) {
    return NextResponse.json({ error: "Email, recovery code, and a new password are required." }, { status: 400 });
  }

  const result = await resetPasswordWithRecoveryCode(email, recoveryCode, newPassword, clientIp(request));
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 400 });
  }

  const response = NextResponse.json({ user: result.user, recoveryCode: result.recoveryCode });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
