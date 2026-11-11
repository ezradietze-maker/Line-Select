import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { crossSiteRefusal } from "@/lib/server/same-origin";
import { disconnect, isLiveWired } from "@/lib/server/fedex-session";
import { toView } from "@/lib/fedex-connect/types";

export const runtime = "nodejs";

/** Disconnect FedEx: delete any session material and clear the connection. The pilot's audit history is kept. */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;

  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // Each one writes the record and its audit.
  if (!(await checkRateLimit("fedex-disconnect", user.id, 30, 60 * 60)).ok) return rateLimitedResponse();

  const conn = await disconnect(user.id);
  return NextResponse.json({ connection: toView(conn, isLiveWired()) });
}
