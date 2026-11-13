import { NextResponse } from "next/server";
import { callCeilingUsd, failedCallCost, schemaChars, structuredCall } from "@/lib/brain/llm";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { pilotSpender, spendLimitResponse, startPaidCall } from "@/lib/server/spend-guard";

/** A pilot's reason, as typed in one box; the catalog's variables, with room to grow. */
const MAX_FREE_TEXT = 1_000;
const MAX_VARIABLES = 400;

export const runtime = "nodejs";

/** A short reason against a fixed list: the smallest current model does it, at a tenth of the old one's price. */
const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 2_000;

/**
 * Maps a pilot's free-text explanation onto the existing implicit taxonomy,
 * or flags it as a genuinely new candidate variable when it doesn't fit
 * (Section 5.4). This is the one place in the feature that calls an LLM —
 * everywhere else in the learning loop is plain arithmetic on real trip
 * data. Two callers, two framings of the same free text:
 *  - A drag-and-drop correction: the pilot preferred one specific trip over
 *    another (`favoredSummary`/`overtakenSummary`).
 *  - An interview follow-up: the pilot leaned hard on a slider with no
 *    specific trip pair involved (`context` — the question and which way
 *    they leaned).
 * Exactly one framing is provided per request.
 *
 * Guardrail (Section 9): the model is instructed to never infer a sensitive
 * category (medical, family/custody, financial hardship) that the pilot
 * didn't literally state — if the text volunteers something sensitive, it's
 * stored as their own words tied to their own account via the candidate-
 * variable path, not turned into an invented structured category.
 */

interface ClassifyRequest {
  freeText: string;
  variables: { id: string; label: string; description: string }[];
  favoredSummary?: string;
  overtakenSummary?: string;
  context?: string;
}

interface ClassifyResult {
  matchedVariableId: string | null;
  direction: "favors_more" | "favors_less" | null;
  proposedName: string | null;
  proposedDescription: string | null;
}

function buildPrompt(req: ClassifyRequest): string {
  const variableList = req.variables.map((v) => `- ${v.id}: ${v.label} — ${v.description}`).join("\n");
  const situation =
    req.favoredSummary && req.overtakenSummary
      ? `A pilot was asked why they preferred one flight trip over another. Here is the comparison and their answer.

Trip they preferred: ${req.favoredSummary}
Trip they ranked lower: ${req.overtakenSummary}
Their answer: "${req.freeText}"`
      : `A pilot gave a strong answer to a preference question during an interview and was asked to explain why, in their own words.

${req.context}
Their answer: "${req.freeText}"`;

  return `${situation}

Here is the existing list of tracked preference variables:
${variableList}

Decide whether their answer clearly describes one of the variables above (it does not need to use the same words — match on meaning), and if so, whether their answer means they want MORE of that variable's raw measured value or LESS of it.

If their answer does not clearly match any variable in the list, propose a short new variable name and one-sentence description that would capture it, generic enough to apply to other trips or schedules (do not just restate the exact quote).

Never invent or infer a sensitive personal category (medical condition, family/custody situation, financial hardship, etc.) that was not literally stated — if the answer touches on something sensitive, treat it the same as any other unmatched answer: propose a plain, literal name for what they said, don't diagnose or categorize the underlying reason.

Answer with matchedVariableId and direction when it matches (the other two null), or proposedName and proposedDescription when it doesn't (the first two null).`;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matchedVariableId", "direction", "proposedName", "proposedDescription"],
  properties: {
    matchedVariableId: nullable({ type: "string" }),
    direction: nullable({ type: "string", enum: ["favors_more", "favors_less"] }),
    proposedName: nullable({ type: "string" }),
    proposedDescription: nullable({ type: "string" }),
  },
};

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { ok } = await checkRateLimit("classify-preference", user.id, 60, 60 * 60);
  if (!ok) return rateLimitedResponse();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Classification isn't configured on this server." }, { status: 503 });
  }

  const body = (await readJsonBody(request, 50_000)) as Partial<ClassifyRequest> | null;
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const hasPairwiseContext = typeof body.favoredSummary === "string" && typeof body.overtakenSummary === "string";
  const hasStandaloneContext = typeof body.context === "string" && body.context.trim().length > 0;
  // At least one variable, and short: `[].every` was true, so an empty list (or one free text near the body's 50 KB)
  // was a paid call for nothing.
  const validVariables =
    Array.isArray(body.variables) &&
    body.variables.length > 0 &&
    body.variables.length <= MAX_VARIABLES &&
    body.variables.every(
      (v) => isJsonObject(v) && isText(v.id, 80) && isText(v.label, 200) && isText(v.description, 600)
    );
  if (
    typeof body.freeText !== "string" ||
    !body.freeText.trim() ||
    body.freeText.length > MAX_FREE_TEXT ||
    !validVariables ||
    (!hasPairwiseContext && !hasStandaloneContext)
  ) {
    return NextResponse.json({ error: "Missing classification input." }, { status: 400 });
  }

  const system = "You match a pilot's own reason for a preference to a list of tracked preference variables.";
  const prompt = buildPrompt(body as ClassifyRequest);
  const paid = await startPaidCall(pilotSpender(user.id, request), callCeilingUsd(MODEL, system.length + prompt.length + schemaChars(SCHEMA), MAX_TOKENS));
  if (!paid.ok) return spendLimitResponse(paid);
  let parsed: ClassifyResult;
  let spent = 0;
  try {
    const r = await structuredCall<ClassifyResult>({ apiKey, model: MODEL, system, user: { fresh: prompt }, schema: SCHEMA, effort: "low", maxTokens: MAX_TOKENS });
    spent = r.usage.costUsd;
    parsed = r.data;
  } catch (e) {
    spent = failedCallCost(e);
    return NextResponse.json({ error: "Couldn't reach the classification service." }, { status: 502 });
  } finally {
    await paid.finish(spent);
  }

  const validVariableIds = new Set(body.variables!.map((v) => v.id));
  const matchedVariableId = parsed.matchedVariableId && validVariableIds.has(parsed.matchedVariableId) ? parsed.matchedVariableId : null;

  return NextResponse.json({
    matchedVariableId,
    direction: matchedVariableId ? parsed.direction : null,
    proposedName: matchedVariableId ? null : parsed.proposedName,
    proposedDescription: matchedVariableId ? null : parsed.proposedDescription,
  } satisfies ClassifyResult);
}
