import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { SESSION_COOKIE, resetPasswordWithEmailToken, sessionCookieOptions } from "@/lib/server/auth";
import { checkRequestLimit, clientIp, deviceIdFrom, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const { ok } = await checkRequestLimit("auth-reset-email", request, 20, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { token?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (!isText(body.token, 200) || !isText(body.newPassword, 500)) {
    return NextResponse.json({ error: "A reset link and a new password are required." }, { status: 400 });
  }

  const result = await resetPasswordWithEmailToken(body.token, body.newPassword, clientIp(request), deviceIdFrom(request));
  if (!result.ok || !result.user || !result.sessionToken) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 400 });
  }

  // A recovery code only when the reset replaced it (an account confirmed by this reset): shown once, then gone.
  const response = NextResponse.json({ user: result.user, recoveryCode: result.recoveryCode });
  response.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return response;
}
