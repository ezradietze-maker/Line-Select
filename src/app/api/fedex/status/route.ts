import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { isLiveWired, readConnection, saveConnection } from "@/lib/server/fedex-session";
import { toView } from "@/lib/fedex-connect/types";

export const runtime = "nodejs";

/**
 * The pilot's own FedEx-connection status and audit trail. Signed-in only, and only ever their own record. Reading it
 * also persists any expiry that happened since the last read (expired session material is dropped on read).
 */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("fedex-status", user.id, 240, 60 * 60)).ok) return rateLimitedResponse();
  const { conn, changed } = await readConnection(user.id);
  // Saved only when reading changed it (an expired session, consent to old wording): saved on every view, it wrote a
  // record for every signed-in visitor and could put back a copy a connect or disconnect had just replaced.
  if (changed) await saveConnection(conn);
  return NextResponse.json({ connection: toView(conn, isLiveWired()) });
}
