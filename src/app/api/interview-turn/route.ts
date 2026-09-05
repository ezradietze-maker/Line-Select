import { NextResponse } from "next/server";
import { runInterviewTurn } from "@/lib/interview-turn-service";
import type { TurnRequestBody } from "@/types/interview-session";

export const runtime = "nodejs";

/**
 * Thin HTTP wrapper around `runInterviewTurn` (`src/lib/interview-turn-service.ts`,
 * which carries the actual system prompt, tool schema, and response
 * validation — see its own doc comment for why this is one Anthropic call
 * per turn and why tool_use rather than regex-extracted JSON).
 *
 * No sign-in required, gated purely on the API key being configured —
 * deliberately following `hotels/route.ts`'s guest-first posture, not
 * `classify-preference/route.ts`'s sign-in requirement, since the interview
 * is core, guest-accessible functionality the same way upload/results
 * already are. This does mean the endpoint has no server-enforced turn cap
 * (the hard ceiling is enforced client-side) — the same risk class
 * `hotels/route.ts` already accepts for unlimited paid lookups today.
 */
export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "The adaptive interview isn't configured on this server." }, { status: 503 });
  }

  let body: Partial<TurnRequestBody>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Array.isArray(body.transcript) || !Array.isArray(body.facts) || !body.grounding) {
    return NextResponse.json({ error: "Missing interview turn input." }, { status: 400 });
  }

  const result = await runInterviewTurn(apiKey, body as TurnRequestBody);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.turn);
}
