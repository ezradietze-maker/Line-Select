import { NextResponse } from "next/server";
import { nextInterviewStep, type LinePairCandidate, type LinePairDifference, type ThreadState } from "@/lib/brain/interviewer";
import type { QuestionExample } from "@/lib/brain/question-examples";
import { MAX_CONTEXT, MAX_PACK_BRIEF, readCohort, readExchanges, readModel } from "@/lib/server/brain-input";
import { fleetNotesFor } from "@/lib/server/fleet-notes";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Hard ceiling on interview length, whatever the client asks for — a safety net, not a target. */
const MAX_TURNS = 40;

function readThreads(value: unknown): Record<string, ThreadState> {
  if (!isJsonObject(value)) return {};
  const out: Record<string, ThreadState> = {};
  for (const [id, t] of Object.entries(value).slice(0, 200)) {
    if (!isJsonObject(t)) continue;
    const status = t.status === "settled" || t.status === "parked" ? t.status : "open";
    out[id.slice(0, 80)] = { status, timesAsked: typeof t.timesAsked === "number" ? Math.max(0, Math.min(10, t.timesAsked)) : 0 };
  }
  return out;
}

function readPairs(value: unknown): LinePairCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 5)
    .filter((p): p is Record<string, unknown> => isJsonObject(p))
    .filter((p) => typeof p.index === "number" && isText(p.a, 10) && isText(p.b, 10) && isText(p.tension, 1200) && isText(p.summaryA, 2000) && isText(p.summaryB, 2000))
    .map((p) => ({
      index: p.index as number,
      a: p.a as string,
      b: p.b as string,
      trade: typeof p.trade === "string" ? p.trade.slice(0, 200) : "",
      tension: p.tension as string,
      differences: readDifferences(p.differences),
      summaryA: p.summaryA as string,
      summaryB: p.summaryB as string,
    }));
}

/** The real lines and trips the client offers to show with a question (see `question-examples.ts`). */
function readExamples(value: unknown): QuestionExample[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 30)
    .filter((e): e is Record<string, unknown> => isJsonObject(e))
    .filter((e) => isText(e.id, 8) && (e.kind === "line" || e.kind === "trip") && isText(e.ref, 40) && isText(e.title, 80) && isText(e.fact, 300) && isText(e.summary, 400))
    .map((e) => ({
      id: e.id as string,
      kind: e.kind as "line" | "trip",
      ref: e.ref as string,
      title: e.title as string,
      fact: e.fact as string,
      summary: e.summary as string,
      ...(typeof e.rank === "number" && Number.isFinite(e.rank) ? { rank: Math.round(e.rank) } : {}),
      ...(isText(e.criterionId, 80) ? { criterionId: e.criterionId as string } : {}),
      ...(isText(e.priority, 200) ? { priority: e.priority as string } : {}),
    }));
}

/** The pack's line and trip numbers, so a question can't name one that doesn't exist; undefined when not sent. */
function readPackNumbers(value: unknown): { lines: string[]; trips: string[] } | undefined {
  if (!isJsonObject(value) || !Array.isArray(value.lines) || !Array.isArray(value.trips)) return undefined;
  const nums = (xs: unknown[]) => xs.slice(0, 2000).filter((x): x is string => typeof x === "string" && /^\d{1,5}$/.test(x));
  return { lines: nums(value.lines), trips: nums(value.trips) };
}

function readDifferences(value: unknown): LinePairDifference[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 6)
    .filter((d): d is Record<string, unknown> => isJsonObject(d))
    .filter((d) => isText(d.label, 120) && isText(d.metric, 60) && isText(d.a, 80) && isText(d.b, 80) && (d.better === "a" || d.better === "b"))
    .map((d) => ({ label: d.label as string, metric: d.metric as string, a: d.a as string, b: d.b as string, better: d.better as "a" | "b" }));
}

/** The interviewer's next move: one question drawn from the pilot's own threads, or "done". See `nextInterviewStep`. */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("brain-question", clientIp(request), 150, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "The interview isn't configured on this server." }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const exchanges = readExchanges(body.exchanges);
  if (!isText(body.packBrief, MAX_PACK_BRIEF) || !isText(body.pilotContext, MAX_CONTEXT) || !exchanges || typeof body.turn !== "number") {
    return NextResponse.json({ error: "Missing interview input." }, { status: 400 });
  }
  const model = body.model === null || body.model === undefined ? null : readModel(body.model);
  const maxTurns = Math.min(MAX_TURNS, typeof body.maxTurns === "number" ? body.maxTurns : MAX_TURNS);
  const rankingShifts = Array.isArray(body.rankingShifts)
    ? body.rankingShifts.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(-20).map((n) => Math.max(0, Math.min(50, Math.round(n))))
    : [];

  try {
    const notes = await fleetNotesFor(readCohort(body.cohort));
    const step = await nextInterviewStep({ apiKey, packBrief: body.packBrief, pilotContext: body.pilotContext, exchanges, model, threads: readThreads(body.threads), linePairs: readPairs(body.linePairs), examples: readExamples(body.examples), packNumbers: readPackNumbers(body.packNumbers), turn: body.turn, maxTurns, fleetNotes: notes, rankingShifts });
    const { usage, ...rest } = step;
    if (usage) console.log("[brain-question]", { turn: body.turn, done: step.done, costUsd: +usage.costUsd.toFixed(4), ms: usage.ms });
    return NextResponse.json(rest);
  } catch (e) {
    console.error("[brain-question] failed", e);
    return NextResponse.json({ error: "Couldn't come up with the next question just now. Please try again." }, { status: 502 });
  }
}
