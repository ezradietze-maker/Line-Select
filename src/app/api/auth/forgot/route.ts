import { NextResponse } from "next/server";
import { requestPasswordResetEmail } from "@/lib/server/auth";
import { isEmailConfigured } from "@/lib/server/email";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Whether email reset is available here — lets the sign-in screen offer it only when it will actually work. */
export async function GET() {
  return NextResponse.json({ emailEnabled: isEmailConfigured() });
}

export async function POST(request: Request) {
  const { ok } = await checkRateLimit("auth-forgot", clientIp(request), 10, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.email) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });

  const emailEnabled = await requestPasswordResetEmail(body.email);
  return NextResponse.json({ emailEnabled });
}
