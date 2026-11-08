import { NextResponse } from "next/server";
import { failedCallCost } from "@/lib/brain/llm";
import { askContract, MAX_FACTS_CHARS, MAX_QUESTION_CHARS } from "@/lib/contract/ask";
import { currentBidMonth } from "@/lib/contract/phases";
import { reportProblem } from "@/lib/server/alerts";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { onceForRequest } from "@/lib/server/replay";
import { checkSpend, recordSpend, spenderFor, spendLimitResponse } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Questions a day. Each costs about a quarter of a cent, so these are about abuse, not budget. */
const DAILY_PILOT = 40;
const DAILY_GUEST = 5;
const DAY = 24 * 60 * 60;

/** Ask the contract: an answer in the contract's own words with its section numbers, or "not found" (see `lib/contract/ask.ts`). */
export async function POST(request: Request) {
  return onceForRequest(request, 45_000, () => respond(request));
}

async function respond(request: Request) {
  const { ok } = await checkRequestLimit("contract-ask", request, 20, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const spender = await spenderFor(request);
  const daily = await checkRateLimit("contract-ask-day", spender.key, spender.signedIn ? DAILY_PILOT : DAILY_GUEST, DAY);
  if (!daily.ok) {
    const error = spender.signedIn ? "That's today's questions used up. They come back tomorrow." : "That's today's questions for guests. Sign in to ask more.";
    return NextResponse.json({ error }, { status: 429 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Questions aren't set up on this server." }, { status: 503 });
  const allowed = await checkSpend(spender);
  if (!allowed.ok) return spendLimitResponse(allowed);

  const body = await readJsonBody(request, 10_000);
  if (!isJsonObject(body) || !isText(body.question, MAX_QUESTION_CHARS) || !(body.question as string).trim()) {
    return NextResponse.json({ error: `Ask a question of up to ${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }
  if (body.facts !== undefined && !isText(body.facts, MAX_FACTS_CHARS)) return NextResponse.json({ error: "Those pack details are too long." }, { status: 400 });
  const bidMonth = typeof body.bidMonth === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(body.bidMonth) ? body.bidMonth : currentBidMonth();

  try {
    const r = await askContract({ question: (body.question as string).trim(), facts: body.facts as string | undefined, bidMonth, apiKey });
    await recordSpend(spender, r.usage.costUsd);
    console.log("[contract-ask]", { found: r.answer.found, rejected: r.rejected, costUsd: +r.usage.costUsd.toFixed(5), ms: r.usage.ms });
    return NextResponse.json({ answer: r.answer });
  } catch (e) {
    await Promise.all([recordSpend(spender, failedCallCost(e)), reportProblem("contract-ask", e)]);
    return NextResponse.json({ error: "Couldn't answer that just now. Please try again." }, { status: 502 });
  }
}
