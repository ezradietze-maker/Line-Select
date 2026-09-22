import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createFeedbackSubmission, listFeedbackSubmissions } from "@/lib/server/db";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import type { FeedbackCategory, FeedbackSubmission } from "@/types/feedback";

export const runtime = "nodejs";

const VALID_CATEGORIES: FeedbackCategory[] = ["bug", "idea", "confusing", "other"];

/**
 * POST is intentionally open to guests too — feedback is the whole point of
 * a beta cohort, and requiring an account first is exactly the kind of
 * friction that means never hearing about the bug someone hit two screens
 * into their first try. `pilotId`/`pilotEmail` are filled in when the
 * sender happens to be signed in.
 *
 * GET mirrors `/api/candidate-variables`: gated by the same server-only
 * `ADMIN_API_KEY` shared secret rather than a pilot sign-in, since there's
 * no real admin-role concept yet and every submission here may include a
 * pilot's own email — never wire this into pilot-facing UI.
 */
export async function GET(request: Request) {
  const key = request.headers.get("x-admin-key");
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ submissions: await listFeedbackSubmissions() });
}

export async function POST(request: Request) {
  const { ok } = await checkRateLimit("feedback", clientIp(request), 10, 60 * 60);
  if (!ok) return rateLimitedResponse();

  let body: { message?: string; category?: string; page?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Enter some feedback before sending." }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "That's a bit long — keep it under 4000 characters." }, { status: 400 });
  }
  const category: FeedbackCategory = VALID_CATEGORIES.includes(body.category as FeedbackCategory)
    ? (body.category as FeedbackCategory)
    : "other";

  const user = await getCurrentServerUser();

  const submission: FeedbackSubmission = {
    id: randomUUID(),
    pilotId: user?.id ?? null,
    pilotDisplayName: user?.displayName ?? null,
    pilotEmail: user?.email ?? null,
    category,
    message,
    page: typeof body.page === "string" ? body.page.slice(0, 200) : "",
    createdAt: new Date().toISOString(),
  };

  await createFeedbackSubmission(submission);
  return NextResponse.json({ ok: true });
}
