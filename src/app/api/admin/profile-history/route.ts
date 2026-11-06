import { NextResponse } from "next/server";
import { findUserByEmail, getPreferenceProfileRecord } from "@/lib/server/db";
import { listKeptVersions } from "@/lib/server/profile-history";
import { secretMatches } from "@/lib/server/secret";

export const runtime = "nodejs";

/**
 * Admin-only: one pilot's saved profile and the versions it replaced in the last 30 days (`profile-history.ts`), for
 * when a pilot says their logbook or priorities vanished. Same `ADMIN_API_KEY` gate as the other admin routes; read
 * only — restoring a version is a deliberate step taken by hand.
 *
 *   GET /api/admin/profile-history?email=pilot@example.com   (header x-admin-key)
 */
export async function GET(request: Request) {
  if (!secretMatches(request.headers.get("x-admin-key"), process.env.ADMIN_API_KEY)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Add ?email=…" }, { status: 400 });
  const user = await findUserByEmail(email);
  if (!user) return NextResponse.json({ error: "No account with that email." }, { status: 404 });
  const [current, versions] = await Promise.all([getPreferenceProfileRecord(user.id), listKeptVersions(user.id)]);
  return NextResponse.json({ current, versions }, { headers: { "Cache-Control": "private, no-store" } });
}
