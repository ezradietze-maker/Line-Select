import { NextResponse } from "next/server";
import { getCurrentServerUser, resendConfirmEmail, resendConfirmEmailByAddress } from "@/lib/server/auth";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { afterResponse } from "@/lib/server/after-response";
import { reportProblem } from "@/lib/server/alerts";
import { checkRateLimit, clientIp, deviceIdFrom, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

/** What "Send the link again" by address always answers: the same whether the address has an account waiting on its link, a confirmed one, or none. */
export const SENT_IF_WAITING = "If that address has an account waiting to be confirmed, a new link is on its way. It works for 24 hours.";

/**
 * "Send it again": a fresh confirm link, replacing the last one. Signed in, to the pilot's own address. Signed out, by
 * the address in the body, from the log-in screen, for a pilot who signed up and can't sign in until they confirm.
 */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const user = await getCurrentServerUser();
  if (!user) {
    // Per address, whatever the device: a device cookie costs one page load, so counted per device it was ten an hour
    // for every page load.
    const from = clientIp(request);
    if (!(await checkRateLimit("confirm-resend-by-address", from, 10, 60 * 60)).ok) return rateLimitedResponse();
    const body = await readJsonBody(request, 1_000);
    if (!isJsonObject(body) || !isText(body.email, 200) || !body.email) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
    // Answered at once, and the lookup and email run after, so how long the answer takes says nothing about the address.
    const email = body.email;
    const device = deviceIdFrom(request);
    afterResponse(() => resendConfirmEmailByAddress(email, from, device).catch((e) => reportProblem("accounts", e, { action: "resend by address" })));
    return NextResponse.json({ sent: "if-waiting", message: SENT_IF_WAITING });
  }
  const result = await resendConfirmEmail(user, clientIp(request), deviceIdFrom(request));
  if (result.sent) return NextResponse.json({ sent: true, email: user.email });
  if (result.reason === "confirmed") return NextResponse.json({ sent: false, confirmed: true });
  if (result.reason === "not-set-up") return NextResponse.json({ sent: false, error: "Line Select can't send email yet, so your address can't be confirmed for now." }, { status: 503 });
  if (result.reason === "limited") return NextResponse.json({ sent: false, error: "We've sent a few already. Check your inbox and spam folder, or try again in an hour." }, { status: 429 });
  return NextResponse.json({ sent: false, error: "That didn't send. Try again in a few minutes." }, { status: 502 });
}
