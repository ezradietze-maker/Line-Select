import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { crossSiteRefusal } from "@/lib/server/same-origin";
import { getConnection, isLiveWired, saveConnection, withAudit } from "@/lib/server/fedex-session";
import { CONSENT_VERSION } from "@/lib/fedex-connect/consent";
import { toView } from "@/lib/fedex-connect/types";

export const runtime = "nodejs";

/**
 * Record a pilot's consent to connect FedEx. This does NOT sign in to FedEx and does NOT create a live session — the
 * real sign-in happens on FedEx's own PurpleID page, in the pilot's own browser, and the live feed is not wired yet
 * (phase-1 discovery). So accepting here moves the connection to "coming soon": consent is on file, the live read is
 * stubbed. No password is ever asked for, seen, or stored.
 *
 * The body must carry the exact consent version the pilot saw, so we never record consent to wording they didn't read.
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;

  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { consentVersion?: string };
  try {
    body = (await request.json()) as { consentVersion?: string };
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (body.consentVersion !== CONSENT_VERSION) {
    return NextResponse.json({ error: "The consent has changed. Please read it again." }, { status: 409 });
  }

  const now = Date.now();
  const conn = await getConnection(user.id);
  const updated = withAudit(
    { ...conn, status: "coming-soon" as const, consentVersion: CONSENT_VERSION, consentAt: now },
    { at: now, action: "consent", detail: "You accepted the FedEx connection terms. The live feed isn't switched on yet." },
  );
  await saveConnection(updated);
  return NextResponse.json({ connection: toView(updated, isLiveWired()) });
}
