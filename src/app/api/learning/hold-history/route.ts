import { NextResponse } from "next/server";
import { summarizeHoldHistory } from "@/lib/learning/hold-history";
import { getCurrentServerUser } from "@/lib/server/auth";
import { hashUser } from "@/lib/server/forecast-store";
import { listPilotHoldRecords } from "@/lib/server/learning-store";

export const runtime = "nodejs";

/** A signed-in pilot's own record of what they've held, month after month — only ever their own. */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your history." }, { status: 401 });
  try {
    return NextResponse.json({ history: summarizeHoldHistory(await listPilotHoldRecords(hashUser(user.id))) });
  } catch (e) {
    console.error("[learning] hold history failed", e);
    return NextResponse.json({ history: null }, { status: 503 });
  }
}
