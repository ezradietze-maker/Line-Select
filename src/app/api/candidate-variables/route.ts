import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createCandidateVariable, listCandidateVariables } from "@/lib/server/db";
import type { CandidateVariable } from "@/types/candidate-variable";

export const runtime = "nodejs";

/**
 * Candidate variables a pilot's free-text explanation didn't map onto an
 * existing taxonomy entry (Section 5.4/5.8's admin-review list) — a real
 * running log, not a cross-pilot clustering pipeline, since this app has no
 * real pilot population yet for clustering to mean anything. GET lists them
 * for review; POST is called internally by the classify route, not directly
 * by the client.
 *
 * GET is gated by a server-only shared secret (`ADMIN_API_KEY`), not a
 * pilot sign-in — each entry carries another pilot's own `pilotId` and
 * verbatim `rawQuote`, and there's no real admin-role concept in this app
 * yet to check against, so "signed in" would mean "any pilot" here. A
 * shared secret only the developer holds is the right-sized fix until an
 * actual admin role exists to justify the complexity of one — never wire
 * this into pilot-facing UI, and check with `curl -H "x-admin-key: ..."`
 * instead.
 */

export async function GET(request: Request) {
  const key = request.headers.get("x-admin-key");
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ candidates: await listCandidateVariables() });
}

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    rawQuote?: string;
    proposedName?: string;
    proposedDescription?: string;
    favoredLineNumber?: string;
    overtakenLineNumber?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  if (
    !isText(body.rawQuote, 2000) ||
    !isText(body.proposedName, 200) ||
    (body.proposedDescription !== undefined && typeof body.proposedDescription !== "string") ||
    (body.favoredLineNumber !== undefined && typeof body.favoredLineNumber !== "string") ||
    (body.overtakenLineNumber !== undefined && typeof body.overtakenLineNumber !== "string")
  ) {
    return NextResponse.json({ error: "Missing candidate variable details." }, { status: 400 });
  }

  const candidate: CandidateVariable = {
    id: randomUUID(),
    pilotId: user.id,
    rawQuote: body.rawQuote,
    proposedName: body.proposedName,
    proposedDescription: (body.proposedDescription ?? "").slice(0, 500),
    favoredLineNumber: (body.favoredLineNumber ?? "").slice(0, 12),
    overtakenLineNumber: (body.overtakenLineNumber ?? "").slice(0, 12),
    createdAt: new Date().toISOString(),
  };

  await createCandidateVariable(candidate);
  return NextResponse.json({ candidate });
}
