import Anthropic from "@anthropic-ai/sdk";
import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
import { buildInterviewSystemPrompt } from "@/lib/interview-prompt";
import { allKnownVariableDescriptors } from "@/lib/preference-classifier";
import type {
  ExplicitWeightKey,
  InterviewQuestion,
  PreferenceFact,
  PreferenceFactUpdate,
  TurnRequestBody,
  TurnResponse,
} from "@/types/interview-session";
import { DEFAULT_WEIGHTS, type ExplicitTargetKey } from "@/types/preferences";

/**
 * The adaptive interview's turn loop, as a plain framework-agnostic
 * function — one Anthropic call per turn, handling both "what to ask next"
 * and "what to extract from the pilot's last answer" (see
 * `interview-prompt.ts`'s own doc comment for why this is one call, not
 * two). Deliberately has no `next/server` import so it can be called
 * identically from the real API route (`src/app/api/interview-turn/route.ts`)
 * and from the standalone transcript-testing script
 * (`scripts/run-adaptive-interview-transcript.ts`) — the whole point of
 * Phase 2's "test against text transcripts before UI" requirement is that
 * this exact code path, not a reimplementation of it, is what gets
 * exercised outside a browser.
 *
 * Uses forced tool_use rather than the "respond with ONLY JSON" + regex
 * convention the two existing LLM routes (`classify-preference`, `hotels`)
 * use — this turn's response shape (a 5-variant question union, plus an
 * array of multi-field profile updates with their own nested binding union)
 * is structurally much bigger, and a malformed response here aborts an
 * entire mid-conversation turn, not one silent classification no-op.
 */

const MODEL = "claude-sonnet-5";

const EXPLICIT_TARGET_KEYS: ExplicitTargetKey[] = ["daysOff", "creditHours", "departures"];

const TURN_TOOL: Anthropic.Tool = {
  name: "submit_interview_turn",
  description:
    "Submit this turn's decision: either the next question to ask, or a decision to wrap up the interview, plus any updates to the pilot's profile learned from their last answer.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["ask", "wrap_up"] },
      question: {
        type: ["object", "null"],
        description: "Required when action is 'ask'; null when action is 'wrap_up'.",
        properties: {
          kind: { type: "string", enum: ["slider", "target-slider", "choice", "free-text", "wrap-up"] },
          prompt: { type: "string", description: "The question text itself, in pilot voice." },
          helpText: { type: "string", description: "Optional one-line context shown under the prompt." },
          boundTo: {
            type: "string",
            description:
              "Required for kind 'slider' or 'target-slider'. For 'slider', must be one of the EXPLICIT-WEIGHT ids (never 'departures', never an implicit id). For 'target-slider', must be one of the EXPLICIT-TARGET ids (daysOff, creditHours, or departures) — see the system prompt's catalog section for the exact lists.",
          },
          lowLabel: { type: "string", description: "Required for kind 'slider'." },
          highLabel: { type: "string", description: "Required for kind 'slider'." },
          centerLabel: { type: "string", description: "Required for kind 'slider'." },
          unitSingular: { type: "string", description: "Required for kind 'target-slider', e.g. 'day'." },
          unitPlural: { type: "string", description: "Required for kind 'target-slider', e.g. 'days'." },
          options: {
            type: "array",
            description: "Required for kind 'choice' — at least 2 options.",
            items: {
              type: "object",
              properties: { label: { type: "string" }, description: { type: "string" } },
              required: ["label"],
            },
          },
          placeholder: { type: "string", description: "Optional, for kind 'free-text'." },
        },
        required: ["kind", "prompt"],
      },
      profileUpdates: {
        type: "array",
        description: "Deltas from the pilot's last answer. Empty array on turn 1.",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add", "revise", "retire"] },
            factId: { type: "string", description: "Required for op 'retire' — the fact id to remove." },
            fact: {
              type: "object",
              description: "Required for op 'add' or 'revise'.",
              properties: {
                id: { type: "string", description: "Required for op 'revise' — the fact id being updated." },
                statement: { type: "string", description: "Plain-English, pilot-voice, finished copy." },
                kind: { type: "string", enum: ["measurable", "qualitative"] },
                confidence: { type: "number", description: "0-1." },
                importance: { type: "number", description: "0-1." },
                measurable: {
                  type: "object",
                  description: "Required when fact.kind is 'measurable'; omit entirely for 'qualitative'.",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["explicit-weight", "explicit-target", "implicit-weight", "city-sentiment"],
                    },
                    key: { type: "string", description: "For 'explicit-weight' or 'explicit-target'." },
                    direction: {
                      type: "integer",
                      enum: [1, -1],
                      description: "For 'explicit-weight' or 'implicit-weight'.",
                    },
                    value: { type: "number", description: "For 'explicit-target' — the exact pinned number." },
                    variableId: { type: "string", description: "For 'implicit-weight'." },
                    code: { type: "string", description: "For 'city-sentiment' — a real city code from this bid pack." },
                    sentiment: { type: "string", enum: ["love", "avoid"], description: "For 'city-sentiment'." },
                  },
                  required: ["type"],
                },
              },
              required: ["statement", "kind", "confidence", "importance"],
            },
          },
          required: ["op"],
        },
      },
      reasoning: {
        type: "string",
        description: "Internal-only: why you chose this action. Never shown to the pilot.",
      },
    },
    required: ["action", "profileUpdates"],
  },
};

function buildUserMessage(body: TurnRequestBody): string {
  const catalogIds = new Set(allKnownVariableDescriptors().map((d) => d.id));
  return JSON.stringify(
    {
      bidPack: { base: body.base, aircraft: body.aircraft },
      groundingStats: body.grounding,
      isCommuter: body.isCommuter,
      transcript: body.transcript.map((t) => ({ question: t.question, answer: t.answer })),
      currentFacts: body.facts.map((f) => ({
        statement: f.statement,
        kind: f.kind,
        measurable: f.measurable,
        confidence: f.confidence,
        importance: f.importance,
      })),
      turnsUsed: body.turnsUsed,
      softCapTurns: body.softCapTurns,
      hardCeilingTurns: body.hardCeilingTurns,
      validCatalogIds: Array.from(catalogIds),
    },
    null,
    0
  );
}

/** "departures" is deliberately excluded — it's target-only (see `ExplicitTargetKey`), not a dimension the interview can bind directionally the same way a real bipolar/magnitude slider works. */
const PREFERENCE_WEIGHTS_KEYS = new Set(Object.keys(DEFAULT_WEIGHTS).filter((k) => k !== "departures"));

function isPreferenceWeightsKey(key: unknown): key is ExplicitWeightKey {
  return typeof key === "string" && PREFERENCE_WEIGHTS_KEYS.has(key);
}

function isExplicitTargetKey(key: unknown): key is ExplicitTargetKey {
  return typeof key === "string" && (EXPLICIT_TARGET_KEYS as string[]).includes(key);
}

const IMPLICIT_VARIABLE_IDS = new Set(IMPLICIT_VARIABLES.map((v) => v.id));

function isKnownVariableId(id: unknown): boolean {
  return typeof id === "string" && IMPLICIT_VARIABLE_IDS.has(id);
}

/** Validates and reconstructs one raw `measurable` object from the tool input into a real `MeasurableBinding`, or undefined if it doesn't hold up against the real catalog — the runtime allowlist check tool-schema conformance alone doesn't guarantee, the same spirit as `classify-preference`'s existing `validVariableIds` check. */
function parseMeasurableBinding(raw: unknown): PreferenceFact["measurable"] {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;

  if (m.type === "explicit-weight" && isPreferenceWeightsKey(m.key) && (m.direction === 1 || m.direction === -1)) {
    return { type: "explicit-weight", key: m.key, direction: m.direction };
  }
  if (m.type === "explicit-target" && isExplicitTargetKey(m.key) && typeof m.value === "number") {
    return { type: "explicit-target", key: m.key, value: m.value };
  }
  if (m.type === "implicit-weight" && isKnownVariableId(m.variableId) && (m.direction === 1 || m.direction === -1)) {
    return { type: "implicit-weight", variableId: m.variableId as string, direction: m.direction };
  }
  if (m.type === "city-sentiment" && typeof m.code === "string" && (m.sentiment === "love" || m.sentiment === "avoid")) {
    return { type: "city-sentiment", code: m.code, sentiment: m.sentiment };
  }
  return undefined;
}

/** Fallback unit labels when the model mislabels a target-only id as a "slider" (see the coercion in `parseQuestion` below) and so never supplied its own unitSingular/unitPlural. */
const TARGET_UNIT_LABELS: Record<ExplicitTargetKey, [string, string]> = {
  daysOff: ["day off", "days off"],
  creditHours: ["hour", "hours"],
  departures: ["departure", "departures"],
};

function parseQuestion(raw: unknown): InterviewQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.prompt !== "string" || !q.prompt.trim()) return null;
  const id = crypto.randomUUID();
  const helpText = typeof q.helpText === "string" ? q.helpText : undefined;

  // The model occasionally mislabels a target-only id (departures, or
  // daysOff/creditHours when it wants an exact number) as kind "slider"
  // despite the system prompt's explicit instruction not to — rather than
  // failing the whole turn over a shape mismatch when the underlying intent
  // ("ask about this real dimension") is perfectly clear, coerce it into
  // the question kind that actually matches, using either the model's own
  // unit labels (if it happened to include them anyway) or a sensible
  // built-in fallback.
  if (q.kind === "slider" && typeof q.boundTo === "string" && !PREFERENCE_WEIGHTS_KEYS.has(q.boundTo) && isExplicitTargetKey(q.boundTo)) {
    const [fallbackSingular, fallbackPlural] = TARGET_UNIT_LABELS[q.boundTo];
    return {
      id,
      kind: "target-slider",
      prompt: q.prompt,
      helpText,
      boundTo: q.boundTo,
      unitSingular: typeof q.unitSingular === "string" ? q.unitSingular : fallbackSingular,
      unitPlural: typeof q.unitPlural === "string" ? q.unitPlural : fallbackPlural,
    };
  }

  if (q.kind === "slider" && isPreferenceWeightsKey(q.boundTo)) {
    if (typeof q.lowLabel !== "string" || typeof q.highLabel !== "string" || typeof q.centerLabel !== "string") {
      return null;
    }
    return { id, kind: "slider", prompt: q.prompt, helpText, boundTo: q.boundTo, lowLabel: q.lowLabel, highLabel: q.highLabel, centerLabel: q.centerLabel };
  }
  if (q.kind === "target-slider" && isExplicitTargetKey(q.boundTo)) {
    if (typeof q.unitSingular !== "string" || typeof q.unitPlural !== "string") return null;
    return { id, kind: "target-slider", prompt: q.prompt, helpText, boundTo: q.boundTo, unitSingular: q.unitSingular, unitPlural: q.unitPlural };
  }
  if (q.kind === "choice" && Array.isArray(q.options) && q.options.length >= 2) {
    const options = q.options
      .filter((o): o is { label: string; description?: string } => !!o && typeof o.label === "string")
      .map((o) => ({ label: o.label, description: typeof o.description === "string" ? o.description : undefined }));
    if (options.length < 2) return null;
    return { id, kind: "choice", prompt: q.prompt, helpText, options };
  }
  if (q.kind === "free-text") {
    return { id, kind: "free-text", prompt: q.prompt, helpText, placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined };
  }
  if (q.kind === "wrap-up") {
    return { id, kind: "wrap-up", prompt: q.prompt };
  }
  return null;
}

/** Individual bad profile updates are dropped rather than failing the whole turn — the question the pilot needs to keep going is the critical part of the response; losing one mis-shaped fact is low-stakes by comparison. */
function parseProfileUpdates(raw: unknown, turnIndex: number, answeredQuestionId: string | undefined): PreferenceFactUpdate[] {
  if (!Array.isArray(raw)) return [];
  const updates: PreferenceFactUpdate[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const u = item as Record<string, unknown>;

    if (u.op === "retire" && typeof u.factId === "string") {
      updates.push({ op: "retire", factId: u.factId });
      continue;
    }

    if ((u.op === "add" || u.op === "revise") && u.fact && typeof u.fact === "object") {
      const f = u.fact as Record<string, unknown>;
      if (typeof f.statement !== "string" || !f.statement.trim()) continue;
      if (f.kind !== "measurable" && f.kind !== "qualitative") continue;
      if (typeof f.confidence !== "number" || typeof f.importance !== "number") continue;

      const measurable = f.kind === "measurable" ? parseMeasurableBinding(f.measurable) : undefined;
      if (f.kind === "measurable" && !measurable) continue; // claimed measurable but didn't bind to anything real — drop rather than silently score against nothing.

      const fact: PreferenceFact = {
        id: u.op === "revise" && typeof f.id === "string" ? f.id : crypto.randomUUID(),
        statement: f.statement,
        kind: f.kind,
        measurable,
        confidence: Math.min(1, Math.max(0, f.confidence)),
        importance: Math.min(1, Math.max(0, f.importance)),
        source: answeredQuestionId
          ? { kind: "adaptive-question", questionId: answeredQuestionId }
          : { kind: "adaptive-question", questionId: "turn-1" },
        turnIndex,
      };
      updates.push({ op: u.op, fact });
    }
  }

  return updates;
}

export type InterviewTurnResult = { ok: true; turn: TurnResponse } | { ok: false; error: string };

export async function runInterviewTurn(apiKey: string, req: TurnRequestBody): Promise<InterviewTurnResult> {
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      // Observed reasoning fields alone running 600-900 output tokens once the
      // interview reaches contradiction-resolution territory (Phase 6 transcript
      // testing) — 1500 left too little headroom, and a truncated tool call means
      // a lost turn (parseQuestion sees an incomplete/missing question object).
      max_tokens: 2200,
      system: buildInterviewSystemPrompt(),
      messages: [{ role: "user", content: buildUserMessage(req) }],
      tools: [TURN_TOOL],
      tool_choice: { type: "tool", name: "submit_interview_turn" },
    });

    console.log("[interview-turn] usage", {
      turnsUsed: req.turnsUsed,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (!toolUse) {
      return { ok: false, error: "Couldn't read the interview response." };
    }

    const input = toolUse.input as Record<string, unknown>;
    const action = input.action === "wrap_up" ? "wrap_up" : "ask";
    const answeredQuestionId = req.transcript[req.transcript.length - 1]?.question.id;
    const profileUpdates = parseProfileUpdates(input.profileUpdates, req.turnsUsed, answeredQuestionId);
    const reasoning = typeof input.reasoning === "string" ? input.reasoning : undefined;

    if (action === "wrap_up") {
      return { ok: true, turn: { action: "wrap_up", question: null, profileUpdates, reasoning } };
    }

    const question = parseQuestion(input.question);
    if (!question) {
      // The tool schema can't express "question is required when action is
      // 'ask'" as a hard constraint (only the top-level action/profileUpdates
      // are truly required), so this does happen in practice — caught live in
      // Phase 6 transcript testing, almost always in the interview's later
      // turns. Treating it as a wrap-up rather than failing the turn outright
      // is a safe interpretation (the model was clearly ambivalent about
      // asking anything further) and avoids bouncing the pilot back to
      // re-answer a question they already answered.
      console.warn("[interview-turn] ask action with no valid question, treating as wrap_up", JSON.stringify(input.question), "stop_reason:", response.stop_reason);
      return { ok: true, turn: { action: "wrap_up", question: null, profileUpdates, reasoning } };
    }

    return { ok: true, turn: { action: "ask", question, profileUpdates, reasoning } };
  } catch (e) {
    console.error("[interview-turn] request failed", e);
    return { ok: false, error: "Couldn't reach the interview service." };
  }
}
