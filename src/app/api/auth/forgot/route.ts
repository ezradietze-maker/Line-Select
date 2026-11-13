import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { requestPasswordResetEmail } from "@/lib/server/auth";
import { afterResponse } from "@/lib/server/after-response";
import { reportProblem } from "@/lib/server/alerts";
import { isEmailConfigured } from "@/lib/server/email";
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

  // Answered at once, and the lookup and the email run after: waiting on them made the answer come a quarter of a
  // second later for an address with an account than for one without. The site's hourly allowance is taken inside,
  // only for an email that's about to go (see `requestPasswordResetEmail`).
  const email = body.email;
  const from = clientIp(request);
  const device = deviceIdFrom(request);
  afterResponse(() => requestPasswordResetEmail(email, from, device).then(() => undefined).catch((e) => reportProblem("accounts", e, { action: "reset email" })));
  return NextResponse.json({ emailEnabled: isEmailConfigured() });
}
