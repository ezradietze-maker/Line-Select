import { NextResponse } from "next/server";
import { noteActivity, reportProblem } from "@/lib/server/alerts";
import { readAskQuery } from "@/lib/brain/ask-pack";
import { MAX_PACK_BRIEF } from "@/lib/server/brain-input";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { checkSpend, recordSpend, spenderFor, spendLimitResponse } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

/** "Ask your pack": a pilot's question read as a query over the app's measures (see `lib/brain/ask-pack.ts`). */
export async function POST(request: Request) {
  const { ok } = await checkRequestLimit("brain-ask", request, 60, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Asking isn't configured on this server." }, { status: 503 });
  const spender = await spenderFor(request);
  const allowed = await checkSpend(spender);
  if (!allowed.ok) return spendLimitResponse(allowed);

  const body = await readJsonBody(request, MAX_PACK_BRIEF + 10_000);
  if (!isJsonObject(body) || !isText(body.question, 400) || !(body.question as string).trim() || !isText(body.packBrief, MAX_PACK_BRIEF)) {
    return NextResponse.json({ error: "Ask a question about your pack (up to 400 characters)." }, { status: 400 });
  }
  try {
    const { query, usage } = await readAskQuery({ question: (body.question as string).trim(), packBrief: body.packBrief as string, apiKey });
    await Promise.all([recordSpend(spender, usage.costUsd), noteActivity("ask")]);
    console.log("[brain-ask]", { conditions: query.conditions.length, costUsd: +usage.costUsd.toFixed(4), ms: usage.ms });
    return NextResponse.json({ query });
  } catch (e) {
    await reportProblem("brain-ask", e);
    return NextResponse.json({ error: "Couldn't read that question just now. Please try again." }, { status: 502 });
  }
}
