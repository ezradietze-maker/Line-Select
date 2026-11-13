import { NextResponse } from "next/server";
import { getCurrentServerUser, resendConfirmEmail } from "@/lib/server/auth";
import { clientIp, deviceIdFrom } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";

export const runtime = "nodejs";

/** "Send it again": a fresh confirm link to the signed-in pilot's own address, replacing the last one. */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const result = await resendConfirmEmail(user, clientIp(request), deviceIdFrom(request));
  if (result.sent) return NextResponse.json({ sent: true, email: user.email });
  if (result.reason === "confirmed") return NextResponse.json({ sent: false, confirmed: true });
  if (result.reason === "not-set-up") return NextResponse.json({ sent: false, error: "Line Select can't send email yet, so your address can't be confirmed for now." }, { status: 503 });
  if (result.reason === "limited") return NextResponse.json({ sent: false, error: "We've sent a few already. Check your inbox and spam folder, or try again in an hour." }, { status: 429 });
  return NextResponse.json({ sent: false, error: "That didn't send. Try again in a few minutes." }, { status: 502 });
}
