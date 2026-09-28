import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { runInterviewTurn } from "@/lib/interview-turn-service";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";
import { loadStyleSample } from "@/lib/server/style-store";
import type { TurnRequestBody } from "@/types/interview-session";

/** How many anonymized cross-pilot phrases to hand the model each turn — enough for loose calibration, small enough to stay cheap. */
const STYLE_SAMPLE_SIZE = 12;

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
  const { ok } = await checkRateLimit("interview-turn", clientIp(request), 60, 60 * 60);
  if (!ok) return rateLimitedResponse();

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
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  // Every field below is read directly by runInterviewTurn with no further
  // guard of its own — a missing or wrong-typed one (a malformed client
  // state, not necessarily malicious) crashes it with a raw 500 rather than
  // failing here with a clean 400.
  if (
    !Array.isArray(body.transcript) ||
    !Array.isArray(body.facts) ||
    !isJsonObject(body.grounding) ||
    typeof body.base !== "string" ||
    typeof body.aircraft !== "string" ||
    (body.isCommuter !== null && typeof body.isCommuter !== "boolean") ||
    typeof body.turnsUsed !== "number" ||
    typeof body.softCapTurns !== "number" ||
    typeof body.hardCeilingTurns !== "number" ||
    !Array.isArray(body.uncoveredExplicitWeightIds) ||
    (body.bidStory !== undefined && typeof body.bidStory !== "string")
  ) {
    return NextResponse.json({ error: "Missing interview turn input." }, { status: 400 });
  }

  const styleSample = await loadStyleSample(STYLE_SAMPLE_SIZE);
  const result = await runInterviewTurn(apiKey, { ...body, styleSample } as TurnRequestBody);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.turn);
}
