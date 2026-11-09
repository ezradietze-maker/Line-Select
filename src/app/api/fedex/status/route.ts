import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { getConnection, isLiveWired, saveConnection } from "@/lib/server/fedex-session";
import { toView } from "@/lib/fedex-connect/types";

export const runtime = "nodejs";

/**
 * The pilot's own FedEx-connection status and audit trail. Signed-in only, and only ever their own record. Reading it
 * also persists any expiry that happened since the last read (expired session material is dropped on read).
 */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const before = await getConnection(user.id);
  // getConnection may have downgraded an expired session; persist that so the audit and status stay true.
  await saveConnection(before);
  return NextResponse.json({ connection: toView(before, isLiveWired()) });
}
