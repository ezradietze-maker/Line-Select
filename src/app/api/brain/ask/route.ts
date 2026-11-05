import { NextResponse } from "next/server";
import { readAskQuery } from "@/lib/brain/ask-pack";
import { MAX_PACK_BRIEF } from "@/lib/server/brain-input";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** "Ask your pack": a pilot's question read as a query over the app's measures (see `lib/brain/ask-pack.ts`). */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("brain-ask", clientIp(request), 60, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Asking isn't configured on this server." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body) || !isText(body.question, 400) || !(body.question as string).trim() || !isText(body.packBrief, MAX_PACK_BRIEF)) {
    return NextResponse.json({ error: "Ask a question about your pack (up to 400 characters)." }, { status: 400 });
  }
  try {
    const { query, usage } = await readAskQuery({ question: (body.question as string).trim(), packBrief: body.packBrief as string, apiKey });
    console.log("[brain-ask]", { conditions: query.conditions.length, costUsd: +usage.costUsd.toFixed(4), ms: usage.ms });
    return NextResponse.json({ query });
  } catch (e) {
    console.error("[brain-ask] failed", e);
    return NextResponse.json({ error: "Couldn't read that question just now. Please try again." }, { status: 502 });
  }
}
