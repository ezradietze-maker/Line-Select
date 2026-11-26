import { NextResponse } from "next/server";
import { callCeilingUsd, failedCallCost, schemaChars, structuredCall } from "@/lib/brain/llm";
import { reportProblem } from "@/lib/server/alerts";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { onceForRequest } from "@/lib/server/replay";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { spenderFor, spendLimitResponse, startPaidCall } from "@/lib/server/spend-guard";
import { GOAL_KINDS } from "@/lib/vacation-goal";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A short goal against a fixed list of aims: the smallest current model reads it, for about a tenth of a cent. */
const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 1_500;
const MAX_GOAL = 300;
const MAX_CONTEXT = 4_000;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aims"],
  properties: {
    aims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "dates", "cities"],
        properties: {
          kind: { type: "string", enum: [...GOAL_KINDS] },
          dates: { type: "array", items: { type: "string" } },
          cities: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const SYSTEM = `You read what a FedEx pilot wants from their vacation this bid month into a short list of aims, most important first. A vacation can slide up to 5 days either way; the trips it then covers come off the line and are paid from the vacation bank.

Aims (use only these):
- credit: paid time off — cover the most trip credit with the vacation, those trips paid from the bank and not flown ("max my credit", "paid time off", "cover the big trips", "knock out the most flying").
- keep-bank: most money overall — cover the least trip credit, so the pilot flies the most, the vacation sits on days off and the bank is kept for the year-end buyback ("keep my bank", "work as much as possible", "fly the most", "keep my flying", "get paid for both", "the buyback"). Wanting to work or fly more is always keep-bank, never credit: credit takes the most flying off the line.
- pay: the pilot wants pay or money from it but doesn't say which kind ("most pay", "max money", "get paid"): they're asked. Never guess credit or keep-bank for pay alone.
- days-off: the most days off in the month.
- stretch: the longest run of days off in a row.
- weekends: the most weekend days off.
- dates: these days off (give them in "dates" as YYYY-MM-DD, within the bid month the pilot is told).
- keep: keep flying trips that lay over these cities (airport codes in "cities", only codes from the list given).
- drop: have the vacation cover trips to these cities.
- as-awarded: leave the vacation where it is.

Put specific asks (dates, cities to keep or drop) before general ones when the pilot says they must have them ("but", "still", "need"). Leave "dates" and "cities" empty for other kinds. If nothing in the text is about the vacation, answer an empty list. Never invent a date or a city the pilot didn't say.`;

/** "What do you want from your vacation?" when the device couldn't read it (see `lib/vacation-goal.ts`). */
export async function POST(request: Request) {
  return onceForRequest(request, 20_000, () => respond(request));
}

async function respond(request: Request) {
  const { ok } = await checkRequestLimit("vacation-goal", request, 40, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Reading goals isn't set up on this server." }, { status: 503 });
  const body = await readJsonBody(request, 10_000);
  if (!isJsonObject(body) || !isText(body.goal, MAX_GOAL) || !(body.goal as string).trim() || !isText(body.context, MAX_CONTEXT)) {
    return NextResponse.json({ error: "Say what you want from your vacation (up to 300 characters)." }, { status: 400 });
  }
  const prompt = `${body.context as string}\n\nWhat the pilot typed: "${(body.goal as string).trim()}"`;
  const paid = await startPaidCall(await spenderFor(request), callCeilingUsd(MODEL, SYSTEM.length + prompt.length + schemaChars(SCHEMA), MAX_TOKENS));
  if (!paid.ok) return spendLimitResponse(paid);
  let spent = 0;
  try {
    const r = await structuredCall<{ aims: unknown[] }>({ apiKey, model: MODEL, system: SYSTEM, user: { fresh: prompt }, schema: SCHEMA, effort: "low", maxTokens: MAX_TOKENS });
    spent = r.usage.costUsd;
    // The page checks the aims against the pack itself (`cleanAims`); here they only have to be the right shape.
    return NextResponse.json({ aims: Array.isArray(r.data.aims) ? r.data.aims : [] });
  } catch (e) {
    spent = failedCallCost(e);
    await reportProblem("vacation-goal", e);
    return NextResponse.json({ error: "Couldn't read that just now. Try one of the examples, or say it another way." }, { status: 502 });
  } finally {
    await paid.finish(spent);
  }
}
