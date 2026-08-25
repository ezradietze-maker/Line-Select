import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
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
 */

export async function GET() {
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

  if (!body.rawQuote || !body.proposedName) {
    return NextResponse.json({ error: "Missing candidate variable details." }, { status: 400 });
  }

  const candidate: CandidateVariable = {
    id: randomUUID(),
    pilotId: user.id,
    rawQuote: body.rawQuote,
    proposedName: body.proposedName,
    proposedDescription: body.proposedDescription ?? "",
    favoredLineNumber: body.favoredLineNumber ?? "",
    overtakenLineNumber: body.overtakenLineNumber ?? "",
    createdAt: new Date().toISOString(),
  };

  await createCandidateVariable(candidate);
  return NextResponse.json({ candidate });
}
