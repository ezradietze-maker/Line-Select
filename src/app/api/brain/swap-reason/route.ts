import { NextResponse } from "next/server";
import { onceForRequest } from "@/lib/server/replay";
import { failedCallCost } from "@/lib/brain/llm";
import { readSwapReason, swapReasonCeilingUsd, type ReasonOption } from "@/lib/brain/swap-reason";
import { reportProblem } from "@/lib/server/alerts";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { spenderFor, spendLimitResponse, startPaidCall } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

/** The most options of each kind a request may list — a pilot has a few dozen priorities at most. */
const MAX_OPTIONS = 60;

function options(value: unknown): ReasonOption[] | null {
  if (!Array.isArray(value) || value.length > MAX_OPTIONS) return null;
  const out: ReasonOption[] = [];
  for (const o of value) {
    if (!isJsonObject(o) || !isText(o.id, 80) || !isText(o.label, 160) || !isText(o.higher, 80) || !isText(o.lower, 80)) return null;
    out.push({ id: o.id as string, label: o.label as string, higher: o.higher as string, lower: o.lower as string });
  }
  return out;
}

/** Why a pilot swapped two lines, in their words, matched to a priority or measure (see `lib/brain/swap-reason.ts`). */
export async function POST(request: Request) {
  return onceForRequest(request, 25_000, () => respond(request));
}

async function respond(request: Request) {
  const { ok } = await checkRequestLimit("brain-swap-reason", request, 30, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Reading reasons isn't set up on this server." }, { status: 503 });
  const body = await readJsonBody(request, 40_000);
  const priorities = isJsonObject(body) ? options(body.priorities) : null;
  const measures = isJsonObject(body) ? options(body.measures) : null;
  if (!isJsonObject(body) || !isText(body.text, 300) || !(body.text as string).trim() || !isText(body.higher, 20) || !isText(body.lower, 20) || !priorities || !measures) {
    return NextResponse.json({ error: "Tell us why in a sentence (up to 300 characters)." }, { status: 400 });
  }
  const input = { text: (body.text as string).trim(), higher: body.higher as string, lower: body.lower as string, priorities, measures };
  const paid = await startPaidCall(await spenderFor(request), swapReasonCeilingUsd(input));
  if (!paid.ok) return spendLimitResponse(paid);
  let spent = 0;
  try {
    const { reason, usage } = await readSwapReason({ ...input, apiKey });
    spent = usage.costUsd;
    console.log("[swap-reason]", { kind: reason.kind, costUsd: +usage.costUsd.toFixed(5), ms: usage.ms });
    return NextResponse.json({ reason });
  } catch (e) {
    spent = failedCallCost(e);
    await reportProblem("swap-reason", e);
    return NextResponse.json({ error: "Couldn't read that just now. Please try again." }, { status: 502 });
  } finally {
    await paid.finish(spent);
  }
}
