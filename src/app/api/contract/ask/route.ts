import { NextResponse } from "next/server";
import { failedCallCost } from "@/lib/brain/llm";
import { askContract, MAX_FACTS_CHARS, MAX_HISTORY_ANSWER_CHARS, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS, type AskInput, type HistoryTurn } from "@/lib/contract/ask";
import { currentBidMonth } from "@/lib/contract/phases";
import { afterResponse } from "@/lib/server/after-response";
import { reportProblem } from "@/lib/server/alerts";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { onceForRequest, onceForStream, type Remember } from "@/lib/server/replay";
import { checkSpend, recordSpend, spenderFor, spendLimitResponse, type Spender } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Questions a day. Each costs about a quarter of a cent, so these are about abuse, not budget. */
const DAILY_PILOT = 40;
const DAILY_GUEST = 5;
const DAY = 24 * 60 * 60;
const FAILED = "Couldn't answer that just now. Please try again.";

/**
 * Ask the contract: an answer in the contract's own words with its section numbers, or "not found" (see
 * `lib/contract/ask.ts`). The chat asks for ndjson and gets each step as it's really done, then the checked answer;
 * nothing from the model reaches the stream until it has passed the checks.
 */
export async function POST(request: Request) {
  if (request.headers.get("accept")?.includes("ndjson")) return onceForStream(request, 45_000, (remember) => respond(request, remember));
  return onceForRequest(request, 45_000, () => respond(request, null));
}

function history(value: unknown): HistoryTurn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_TURNS) return null;
  const turns: HistoryTurn[] = [];
  for (const t of value) {
    if (!isJsonObject(t) || !isText(t.question, MAX_QUESTION_CHARS) || !isText(t.answer, MAX_HISTORY_ANSWER_CHARS)) return null;
    if (!Array.isArray(t.sections) || t.sections.length > 8 || !t.sections.every((s) => isText(s, 40))) return null;
    turns.push({ question: t.question as string, answer: t.answer as string, sections: t.sections as string[] });
  }
  return turns;
}

async function respond(request: Request, remember: Remember | null): Promise<Response> {
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

  const body = await readJsonBody(request, 20_000);
  if (!isJsonObject(body) || !isText(body.question, MAX_QUESTION_CHARS) || !(body.question as string).trim()) {
    return NextResponse.json({ error: `Ask a question of up to ${MAX_QUESTION_CHARS} characters.` }, { status: 400 });
  }
  if (body.facts !== undefined && !isText(body.facts, MAX_FACTS_CHARS)) return NextResponse.json({ error: "Those pack details are too long." }, { status: 400 });
  const earlier = history(body.history);
  if (!earlier) return NextResponse.json({ error: "That conversation is too long. Start a new chat." }, { status: 400 });
  const bidMonth = typeof body.bidMonth === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(body.bidMonth) ? body.bidMonth : currentBidMonth();
  const input: AskInput = { question: (body.question as string).trim(), history: earlier, facts: body.facts as string | undefined, bidMonth, apiKey };

  return remember ? stream(input, spender, remember) : plain(input, spender);
}

/** Asks, records what it cost, and gives back what the pilot should see. */
async function run(input: AskInput, spender: Spender) {
  try {
    const r = await askContract(input);
    await recordSpend(spender, r.usage.costUsd);
    console.log("[contract-ask]", { found: r.answer.found, rejected: r.rejected, costUsd: +r.usage.costUsd.toFixed(5), ms: r.usage.ms });
    return { answer: r.answer };
  } catch (e) {
    await Promise.all([recordSpend(spender, failedCallCost(e)), reportProblem("contract-ask", e)]);
    return null;
  }
}

async function plain(input: AskInput, spender: Spender): Promise<Response> {
  const reply = await run(input, spender);
  return reply ? NextResponse.json(reply) : NextResponse.json({ error: FAILED }, { status: 502 });
}

function stream(input: AskInput, spender: Spender, remember: Remember): Response {
  const encoder = new TextEncoder();
  let gone = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: unknown) => {
        if (!gone) controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      };
      // The question is paid for once it's asked, so it runs to the end even if the phone drops: the reply it remembers
      // is what a resend of this request gets, instead of paying again.
      const work = (async () => {
        const reply = await run({ ...input, onStep: (text) => send({ type: "step", text }) }, spender);
        await remember(reply ? 200 : 502, reply).catch(() => {});
        send(reply ? { type: "answer", answer: reply.answer } : { type: "error", error: FAILED });
        if (!gone) controller.close();
      })();
      afterResponse(() => work);
    },
    cancel() {
      gone = true;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Keep proxies from buffering the stream into one late chunk.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
