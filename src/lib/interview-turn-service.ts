import Anthropic from "@anthropic-ai/sdk";
import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
import { MIN_TURNS_BEFORE_WRAP, deterministicFactFromAnswer } from "@/lib/interview-engine";
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

/**
 * Built per-turn rather than a static const: below `MIN_TURNS_BEFORE_WRAP`,
 * "wrap_up" is dropped from the action enum entirely so the model cannot
 * select it, no matter how it reads the conversation — a hard, structural
 * floor rather than a soft prompt instruction the model can (and, in real
 * live usage, did) misjudge. See `MIN_TURNS_BEFORE_WRAP`'s own doc comment
 * in `interview-engine.ts` for why this exists.
 */
export function buildTurnTool(canWrapUp: boolean): Anthropic.Tool {
  return {
  name: "submit_interview_turn",
  description: canWrapUp
    ? "Submit this turn's decision: either the next question to ask, or a decision to wrap up the interview, plus any updates to the pilot's profile learned from their last answer."
    : "Submit this turn's decision: the next question to ask (wrapping up is not available yet — there's still real, required ground to cover), plus any updates to the pilot's profile learned from their last answer.",
  input_schema: {
    type: "object",
    properties: {
      action: canWrapUp ? { type: "string", enum: ["ask", "wrap_up"] } : { type: "string", enum: ["ask"] },
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
          rangeRole: {
            type: "string",
            enum: ["min", "ideal", "max"],
            description:
              "Only for kind 'target-slider' on 'daysOff' or 'departures' when you're building a tolerance band (floor/ideal/ceiling) instead of one pinned number — see the system prompt's range-target guidance. Omit entirely for a plain single-number target-slider (including any 'creditHours' target-slider, which never gets range treatment).",
          },
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
            factId: { type: "string", description: "Required for op 'retire' — the id of one of the facts listed in currentFacts (below) to remove. Never invent an id — if nothing in currentFacts is actually wrong, use 'add' instead." },
            fact: {
              type: "object",
              description: "Required for op 'add' or 'revise'.",
              properties: {
                id: { type: "string", description: "Required for op 'revise' — the id of one of the facts listed in currentFacts (below) being updated. Never invent an id you don't see there — if nothing in currentFacts actually needs correcting, use 'add' for a new fact instead of 'revise'." },
                statement: { type: "string", description: "Plain-English, pilot-voice, finished copy." },
                kind: { type: "string", enum: ["measurable", "qualitative"] },
                confidence: { type: "number", description: "0-1." },
                importance: { type: "number", description: "0-1." },
                severity: {
                  type: "string",
                  enum: ["dealbreaker"],
                  description:
                    "Omit for the overwhelming majority of facts. Only include \"dealbreaker\" when the pilot's own words are unambiguous about refusal — \"I will not,\" \"that's a dealbreaker,\" \"I'd reject any line with X.\" Never for a merely strong-sounding preference (\"I really don't like,\" \"I'd rather avoid,\" \"I'm not a fan of\") — those stay ordinary preferences with a high importance value instead. Meaningful on a 'measurable' fact whose binding is 'explicit-weight', 'implicit-weight', or 'city-sentiment'. Also valid on 'explicit-target' but ONLY when rangeRole is 'min' or 'max' — a stated floor or ceiling ('fewer than X days off is a dealbreaker', 'more than Y departures is a dealbreaker') has a real violation condition; a bare pinned 'ideal' number does not, and severity there is dropped.",
                },
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
                    value: { type: "number", description: "For 'explicit-target' — the exact pinned number for this rangeRole." },
                    rangeRole: {
                      type: "string",
                      enum: ["min", "ideal", "max"],
                      description: "For 'explicit-target' only, and only when 'daysOff'/'departures' — mirrors the question's own rangeRole. Omit for a plain single-number target (including creditHours, always).",
                    },
                    variableId: { type: "string", description: "For 'implicit-weight'." },
                    code: { type: "string", description: "For 'city-sentiment' — a real city code from this bid pack." },
                    sentiment: { type: "string", enum: ["love", "avoid"], description: "For 'city-sentiment'." },
                  },
                  required: ["type"],
                },
                cityReason: {
                  type: "object",
                  description:
                    "Only for a qualitative fact that's specifically the 'why' behind a city-sentiment love/avoid pick (never on a measurable fact). Lets this tie back to a real city and, when hotel-related, surface that city's real review summary — without you needing to name the city again in the statement text for the app to find it.",
                  properties: {
                    code: { type: "string", description: "The real city code this reason is about — must match a city-sentiment fact already on file." },
                    category: { type: "string", enum: ["weather", "people", "hotel", "layover-length", "downtime", "other"] },
                  },
                  required: ["code", "category"],
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
}

function buildUserMessage(body: TurnRequestBody): string {
  const catalogIds = new Set(allKnownVariableDescriptors().map((d) => d.id));
  return JSON.stringify(
    {
      bidPack: { base: body.base, aircraft: body.aircraft },
      groundingStats: body.grounding,
      isCommuter: body.isCommuter,
      transcript: body.transcript.map((t) => ({ question: t.question, answer: t.answer })),
      currentFacts: body.facts.map((f) => ({
        id: f.id,
        statement: f.statement,
        kind: f.kind,
        measurable: f.measurable,
        confidence: f.confidence,
        importance: f.importance,
        severity: f.severity,
        volatile: f.volatile,
      })),
      // turnsUsed is zeroed at the true start of the interview (right after
      // the one-off commuter toggle) — there's no separate seed phase to
      // exclude anymore, so this is a plain, honest turn count.
      turnsUsed: body.turnsUsed,
      softCapTurns: body.softCapTurns,
      hardCeilingTurns: body.hardCeilingTurns,
      // Returning-pilot signals — all absent for a first-time interview.
      // priorFactsChanged: facts the pilot themselves flagged as no longer
      // accurate, NOT added to currentFacts since they aren't current
      // anymore — the model's job is to ask what changed, not re-derive them.
      priorFactsChanged: body.priorFactsChanged?.map((f) => ({ statement: f.statement, measurable: f.measurable })),
      lifeEvent: body.lifeEvent,
      // contradictionFlag is set for exactly one turn by the client right
      // after it detects a conflict with a prior-cycle fact — address it
      // directly this turn before moving to fresh ground.
      contradictionFlag: body.contradictionFlag,
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

/** Only "daysOff"/"departures" ever get range treatment — a rangeRole on "creditHours" (or a garbage value) is silently dropped rather than rejecting the whole fact/question over it. */
const RANGE_TARGET_KEYS = new Set<ExplicitTargetKey>(["daysOff", "departures"]);

function parseRangeRole(key: ExplicitTargetKey, raw: unknown): "min" | "ideal" | "max" | undefined {
  if (!RANGE_TARGET_KEYS.has(key)) return undefined;
  return raw === "min" || raw === "ideal" || raw === "max" ? raw : undefined;
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
    return { type: "explicit-target", key: m.key, value: m.value, rangeRole: parseRangeRole(m.key, m.rangeRole) };
  }
  if (m.type === "implicit-weight" && isKnownVariableId(m.variableId) && (m.direction === 1 || m.direction === -1)) {
    return { type: "implicit-weight", variableId: m.variableId as string, direction: m.direction };
  }
  if (m.type === "city-sentiment" && typeof m.code === "string" && (m.sentiment === "love" || m.sentiment === "avoid")) {
    return { type: "city-sentiment", code: m.code, sentiment: m.sentiment };
  }
  return undefined;
}

const CITY_REASON_CATEGORIES = new Set(["weather", "people", "hotel", "layover-length", "downtime", "other"]);

function parseCityReason(raw: unknown): PreferenceFact["cityReason"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== "string" || typeof r.category !== "string" || !CITY_REASON_CATEGORIES.has(r.category)) return undefined;
  return { code: r.code, category: r.category as NonNullable<PreferenceFact["cityReason"]>["category"] };
}

/** Fallback unit labels when the model mislabels a target-only id as a "slider" (see the coercion in `parseQuestion` below) and so never supplied its own unitSingular/unitPlural. */
const TARGET_UNIT_LABELS: Record<ExplicitTargetKey, [string, string]> = {
  daysOff: ["day off", "days off"],
  creditHours: ["hour", "hours"],
  departures: ["departure", "departures"],
  circadianTolerance: ["consecutive report", "consecutive reports"],
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
      rangeRole: parseRangeRole(q.boundTo, q.rangeRole),
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
    return {
      id,
      kind: "target-slider",
      prompt: q.prompt,
      helpText,
      boundTo: q.boundTo,
      unitSingular: q.unitSingular,
      unitPlural: q.unitPlural,
      rangeRole: parseRangeRole(q.boundTo, q.rangeRole),
    };
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

      // Honored on explicit-weight/implicit-weight/city-sentiment always,
      // and on explicit-target ONLY when rangeRole is "min" or "max" — a
      // stated floor or ceiling has a real violation condition (falling
      // below it / exceeding it); a bare pinned "ideal" number doesn't, so
      // the flag is dropped rather than the whole fact (same spirit as
      // dropping a bad `measurable` above: lose the part that doesn't hold
      // up, not the turn).
      const severity =
        f.severity === "dealbreaker" &&
        measurable &&
        (measurable.type === "explicit-weight" ||
          measurable.type === "implicit-weight" ||
          measurable.type === "city-sentiment" ||
          (measurable.type === "explicit-target" && (measurable.rangeRole === "min" || measurable.rangeRole === "max")))
          ? ("dealbreaker" as const)
          : undefined;

      const fact: PreferenceFact = {
        id: u.op === "revise" && typeof f.id === "string" ? f.id : crypto.randomUUID(),
        statement: f.statement,
        kind: f.kind,
        measurable,
        confidence: Math.min(1, Math.max(0, f.confidence)),
        importance: Math.min(1, Math.max(0, f.importance)),
        severity,
        source: answeredQuestionId
          ? { kind: "adaptive-question", questionId: answeredQuestionId }
          : { kind: "adaptive-question", questionId: "turn-1" },
        turnIndex,
        // Only meaningful on a qualitative fact — never on a measurable one, which already has its own real binding.
        cityReason: f.kind === "qualitative" ? parseCityReason(f.cityReason) : undefined,
      };
      updates.push({ op: u.op, fact });
    }
  }

  return updates;
}

export type InterviewTurnResult = { ok: true; turn: TurnResponse } | { ok: false; error: string };

/** One Anthropic call for one turn attempt — factored out so a malformed response below the floor (see below) can be retried with a corrective note rather than duplicating the whole call. */
async function requestTurnFromModel(
  client: Anthropic,
  req: TurnRequestBody,
  canWrapUp: boolean,
  extraNote?: string
): Promise<Record<string, unknown> | null> {
  const response = await client.messages.create({
    model: MODEL,
    // Observed reasoning fields alone running 600-900 output tokens once the
    // interview reaches contradiction-resolution territory (Phase 6 transcript
    // testing) — 1500 left too little headroom, and a truncated tool call means
    // a lost turn (parseQuestion sees an incomplete/missing question object).
    max_tokens: 2200,
    system: buildInterviewSystemPrompt(),
    messages: [{ role: "user", content: extraNote ? `${buildUserMessage(req)}\n\n${extraNote}` : buildUserMessage(req) }],
    tools: [buildTurnTool(canWrapUp)],
    tool_choice: { type: "tool", name: "submit_interview_turn" },
  });

  console.log("[interview-turn] usage", {
    turnsUsed: req.turnsUsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    retry: !!extraNote,
  });

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  return toolUse ? (toolUse.input as Record<string, unknown>) : null;
}

/**
 * The tool schema can't express "question is required when action is 'ask'"
 * as a hard constraint (only the top-level action/profileUpdates are truly
 * required) — the model sometimes returns action "ask" with no question
 * object at all. Below `MIN_TURNS_BEFORE_WRAP` this must never be read as a
 * wrap-up: caught live, this exact gap silently ended a real pilot's
 * interview after only 5 turns even with `buildTurnTool`'s enum restriction
 * in place, because the restriction only ever stopped the model from
 * *choosing* "wrap_up" — it did nothing about "ask" with a missing question,
 * which reached the exact same dead end through the older, separate
 * null-question fallback below.
 */
const MISSING_QUESTION_RETRY_NOTE =
  "IMPORTANT: your previous response had action \"ask\" but no valid \"question\" object. You are still below the minimum-turns floor, so wrapping up is not available yet — you must return action \"ask\" with a complete question object: \"prompt\" is always required, plus lowLabel/highLabel/centerLabel/boundTo for kind \"slider\", unitSingular/unitPlural/boundTo for kind \"target-slider\", or at least 2 \"options\" for kind \"choice\". A kind \"free-text\" question only ever needs \"prompt\" — use that if nothing else fits.";

export async function runInterviewTurn(apiKey: string, req: TurnRequestBody): Promise<InterviewTurnResult> {
  const client = new Anthropic({ apiKey });
  const canWrapUp = req.turnsUsed >= MIN_TURNS_BEFORE_WRAP;
  const lastTurn = req.transcript[req.transcript.length - 1];
  const answeredQuestionId = lastTurn?.question.id;

  try {
    let input = await requestTurnFromModel(client, req, canWrapUp);
    if (!input) {
      return { ok: false, error: "Couldn't read the interview response." };
    }

    // The tool schema itself excludes "wrap_up" from the enum when !canWrapUp
    // (see buildTurnTool), so this shouldn't be reachable — but the schema is
    // a strong steer, not a runtime guarantee, so it's re-checked here rather
    // than trusted blindly.
    if (input.action === "wrap_up" && !canWrapUp) {
      console.warn("[interview-turn] model returned wrap_up before MIN_TURNS_BEFORE_WRAP despite a restricted tool schema", { turnsUsed: req.turnsUsed });
    }
    const action = input.action === "wrap_up" && canWrapUp ? "wrap_up" : "ask";
    let question = action === "ask" ? parseQuestion(input.question) : null;

    // See MISSING_QUESTION_RETRY_NOTE's own doc comment — this is the fix for
    // the live bug, not a defensive nicety: a malformed/missing question this
    // early must never silently collapse into a wrap-up.
    if (action === "ask" && !question && !canWrapUp) {
      console.warn("[interview-turn] ask action with no valid question below MIN_TURNS_BEFORE_WRAP, retrying once", { turnsUsed: req.turnsUsed, rawQuestion: JSON.stringify(input.question) });
      const retryInput = await requestTurnFromModel(client, req, canWrapUp, MISSING_QUESTION_RETRY_NOTE);
      if (retryInput) {
        input = retryInput;
        question = parseQuestion(input.question);
      }
    }

    const profileUpdates = parseProfileUpdates(input.profileUpdates, req.turnsUsed, answeredQuestionId);
    const reasoning = typeof input.reasoning === "string" ? input.reasoning : undefined;

    // Appended after the model's own extraction for this turn (never before
    // it) so it wins any conflict for the same key — see
    // `deterministicFactFromAnswer`'s own doc comment for why the model
    // can't be trusted to correctly restate a number it was already handed.
    // Skipped when the pilot added their own elaboration text: that's
    // exactly the case where the raw value alone can be misleading (a
    // slider answer the pilot's own words go on to contradict or qualify),
    // so here the model's reading — which sees the elaboration too — is the
    // one that should win, not a blind read of the number.
    const elaboration = lastTurn && "elaboration" in lastTurn.answer ? lastTurn.answer.elaboration : undefined;
    if (lastTurn && !elaboration) {
      const deterministicFact = deterministicFactFromAnswer(lastTurn.question, lastTurn.answer, req.turnsUsed);
      if (deterministicFact) profileUpdates.push({ op: "add", fact: deterministicFact });
    }

    if (action === "wrap_up") {
      return { ok: true, turn: { action: "wrap_up", question: null, profileUpdates, reasoning } };
    }

    if (!question) {
      if (!canWrapUp) {
        // The retry above also failed to produce a valid question — never
        // end the interview this early over a malformed response. A generic,
        // always-valid free-text question keeps the loop going rather than
        // silently wrapping up.
        question = {
          id: crypto.randomUUID(),
          kind: "free-text",
          prompt: "What else about your ideal schedule should I know before I put together your ranking?",
        };
      } else {
        // Past the floor, a model that couldn't produce a valid question is
        // a safe signal it was genuinely ambivalent about asking anything
        // further — caught live in Phase 6 transcript testing, almost always
        // in the interview's later turns.
        console.warn("[interview-turn] ask action with no valid question, treating as wrap_up", { turnsUsed: req.turnsUsed, rawQuestion: JSON.stringify(input.question) });
        return { ok: true, turn: { action: "wrap_up", question: null, profileUpdates, reasoning } };
      }
    }

    return { ok: true, turn: { action: "ask", question, profileUpdates, reasoning } };
  } catch (e) {
    console.error("[interview-turn] request failed", e);
    return { ok: false, error: "Couldn't reach the interview service." };
  }
}
