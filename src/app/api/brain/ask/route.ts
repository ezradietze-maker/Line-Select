import { NextResponse } from "next/server";
import { onceForRequest } from "@/lib/server/replay";
import { failedCallCost } from "@/lib/brain/llm";
import { noteActivity, reportProblem } from "@/lib/server/alerts";
import { askQueryCeilingUsd, readAskQuery } from "@/lib/brain/ask-pack";
import { MAX_PACK_BRIEF } from "@/lib/server/brain-input";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { spenderFor, spendLimitResponse, startPaidCall } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

/** "Ask your pack": a pilot's question read as a query over the app's measures (see `lib/brain/ask-pack.ts`). */
/** A copy re-sent after a dropped connection gets the first copy's answer rather than a second paid call (see `onceForRequest`). */
export async function POST(request: Request) {
  return onceForRequest(request, 50_000, () => respond(request));
}

async function respond(request: Request) {
  const { ok } = await checkRequestLimit("brain-ask", request, 60, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Asking isn't configured on this server." }, { status: 503 });
  const body = await readJsonBody(request, MAX_PACK_BRIEF + 10_000);
  if (!isJsonObject(body) || !isText(body.question, 400) || !(body.question as string).trim() || !isText(body.packBrief, MAX_PACK_BRIEF)) {
    return NextResponse.json({ error: "Ask a question about your pack (up to 400 characters)." }, { status: 400 });
  }
  const input = { question: (body.question as string).trim(), packBrief: body.packBrief as string, apiKey };
  const paid = await startPaidCall(await spenderFor(request), askQueryCeilingUsd(input));
  if (!paid.ok) return spendLimitResponse(paid);
  let spent = 0;
  try {
    const { query, usage } = await readAskQuery(input);
    spent = usage.costUsd;
    await noteActivity("ask");
    console.log("[brain-ask]", { conditions: query.conditions.length, costUsd: +usage.costUsd.toFixed(4), ms: usage.ms });
    return NextResponse.json({ query });
  } catch (e) {
    spent = failedCallCost(e);
    await reportProblem("brain-ask", e);
    return NextResponse.json({ error: "Couldn't read that question just now. Please try again." }, { status: 502 });
  } finally {
    await paid.finish(spent);
  }
}
