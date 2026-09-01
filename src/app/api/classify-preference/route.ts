import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";

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

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"matchedVariableId": string or null, "direction": "favors_more" or "favors_less" or null, "proposedName": string or null, "proposedDescription": string or null}`;
}

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Classification isn't configured on this server." }, { status: 503 });
  }

  let body: Partial<ClassifyRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const hasPairwiseContext = !!body.favoredSummary && !!body.overtakenSummary;
  const hasStandaloneContext = !!body.context;
  if (!body.freeText?.trim() || !body.variables || (!hasPairwiseContext && !hasStandaloneContext)) {
    return NextResponse.json({ error: "Missing classification input." }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: buildPrompt(body as ClassifyRequest) }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Classification service unavailable." }, { status: 502 });
    }

    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Couldn't read the classification response." }, { status: 502 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as ClassifyResult;
    const validVariableIds = new Set(body.variables!.map((v) => v.id));
    const matchedVariableId =
      parsed.matchedVariableId && validVariableIds.has(parsed.matchedVariableId) ? parsed.matchedVariableId : null;

    return NextResponse.json({
      matchedVariableId,
      direction: matchedVariableId ? parsed.direction : null,
      proposedName: matchedVariableId ? null : parsed.proposedName,
      proposedDescription: matchedVariableId ? null : parsed.proposedDescription,
    } satisfies ClassifyResult);
  } catch {
    return NextResponse.json({ error: "Couldn't reach the classification service." }, { status: 502 });
  }
}
