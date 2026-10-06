import Anthropic from "@anthropic-ai/sdk";
import { IMPLICIT_VARIABLES } from "@/lib/implicit-dimensions";
import { deterministicFactFromAnswer } from "@/lib/interview-engine";
import { parseAirportCode } from "@/lib/interview-story";
import { QUESTION_TOPICS } from "@/lib/interview-topics";

export { QUESTION_TOPICS };
import { buildBiddingStoryPrompt, buildInterviewSystemPrompt } from "@/lib/interview-prompt";
import { allKnownVariableDescriptors } from "@/lib/preference-classifier";
import type {
  BiddingStoryRequestBody,
  ExplicitWeightKey,
  InterviewAnswer,
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

/** Overridable so a newer model can be tried (or rolled back) from the environment without a code change. */
const MODEL = process.env.INTERVIEW_MODEL || "claude-sonnet-5";

/**
 * Models that refuse a forced tool_choice ("tool"/"any" — the 5.5 family
 * does), learned from the first refusal so every later call skips straight
 * to the fallback instead of failing once per turn.
 */
const MODELS_WITHOUT_FORCED_TOOL = new Set<string>();

/**
 * One tool-calling request that works on every model: a forced tool_choice
 * where the model accepts it, otherwise "auto" with the requirement stated in
 * the system prompt and up to two more tries if the reply comes back as
 * plain text. Returns the response whose tool call should be read (or the
 * last one, when none ever called the tool).
 */
async function createToolCall(
  client: Anthropic,
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, "tool_choice" | "model" | "system"> & {
    system: Anthropic.TextBlockParam[];
  },
  toolName: string
): Promise<Anthropic.Message> {
  if (!MODELS_WITHOUT_FORCED_TOOL.has(MODEL)) {
    try {
      return await client.messages.create({ ...params, model: MODEL, tool_choice: { type: "tool", name: toolName } });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError) || !/tool_choice/.test(e.message)) throw e;
      MODELS_WITHOUT_FORCED_TOOL.add(MODEL);
    }
  }
  const system: Anthropic.TextBlockParam[] = [
    ...params.system,
    { type: "text", text: `Always respond by calling the "${toolName}" tool, never with plain text.` },
  ];
  let response: Anthropic.Message | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Double the budget: these models may think before calling the tool, and
    // a truncated tool call is a lost turn.
    response = await client.messages.create({ ...params, max_tokens: params.max_tokens * 2, model: MODEL, system, tool_choice: { type: "auto" } });
    if (response.content.some((c) => c.type === "tool_use" && c.name === toolName)) break;
  }
  return response!;
}

const EXPLICIT_TARGET_KEYS: ExplicitTargetKey[] = ["daysOff", "creditHours", "dutyPeriods", "circadianTolerance", "tripLength"];

/**
 * Built per-turn rather than a static const: below `MIN_TURNS_BEFORE_WRAP`,
 * "wrap_up" is dropped from the action enum entirely so the model cannot
 * select it, no matter how it reads the conversation — a hard, structural
 * floor rather than a soft prompt instruction the model can (and, in real
 * live usage, did) misjudge. See `MIN_TURNS_BEFORE_WRAP`'s own doc comment
 * in `interview-engine.ts` for why this exists.
 */
/**
 * The `profileUpdates` array's own JSON schema — identical for the normal
 * turn tool and the bidding-story extraction tool below (a fact extracted
 * from the story has to be indistinguishable from one extracted turn by
 * turn), so it's built once and reused rather than kept as two copies that
 * could quietly drift apart.
 */
function profileUpdatesSchemaProperty() {
  return {
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
            statement: { type: "string", description: "Shown to the pilot under \"In your words\": first person, their own key words, one sentence under 25 words, nothing they didn't say." },
            kind: { type: "string", enum: ["measurable", "qualitative"] },
            confidence: { type: "number", description: "0-1." },
            importance: { type: "number", description: "0-1, how strongly THEY said it: exactly 0 doesn't matter, 0.2-0.35 mild lean, 0.4-0.6 clear preference, 0.7-0.85 strong, 0.9-1 top priority." },
            severity: {
              type: "string",
              enum: ["dealbreaker"],
              description:
                "Omit for the overwhelming majority of facts. Only include \"dealbreaker\" when the pilot's own words are unambiguous about refusal — \"I will not,\" \"that's a dealbreaker,\" \"I'd reject any line with X.\" Never for a merely strong-sounding preference (\"I really don't like,\" \"I'd rather avoid,\" \"I'm not a fan of\") — those stay ordinary preferences with a high importance value instead. Also never for a stated number framed as a want/need/target (\"I need at least 16 days off,\" \"I'm trying to stay under 11\") — that's an ordinary explicit-target fact regardless of how firmly it's worded, not a dealbreaker, unless the pilot's words are themselves refusal (\"anything under 16 and I won't bid it\"). Also never for hedged proximity to a dealbreaker (\"that's close to a dealbreaker,\" \"almost a dealbreaker\") — that phrasing is the pilot saying it ISN'T one. Meaningful on a 'measurable' fact whose binding is 'explicit-weight', 'implicit-weight', or 'city-sentiment'. Also valid on 'explicit-target' but ONLY when rangeRole is 'min' or 'max' AND the wording is itself refusal, not just a real number — a bare pinned 'ideal' number never carries severity at all. Also valid on a 'qualitative' fact that carries specificDates or recurringWeekday, when the pilot says they cannot work that day at all (\"I can't miss it, period,\" \"that's a dealbreaker\") — not for \"I'd really like that day off.\"",
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
                  description:
                    "For 'explicit-weight' or 'implicit-weight'. For the magnitude-only explicit-weight ids (hotelFood, hotelGym, hotelGrocery, hotelQuiet, hotelQuality, circadianHealth) this must always be 1 — there is no real opposite for these, so 'doesn't care' is direction 1 with low importance, never -1.",
                },
                value: { type: "number", description: "For 'explicit-target' — the exact pinned number for this rangeRole." },
                rangeRole: {
                  type: "string",
                  enum: ["min", "ideal", "max"],
                  description: "For 'explicit-target' only, and only when 'daysOff'/'dutyPeriods'/'tripLength' — mirrors the question's own rangeRole. Omit for a plain single-number target (including creditHours, always).",
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
                "Only for a qualitative fact that records the pilot's OWN stated reason for loving or avoiding a city — never a reason you inferred or assumed; no reason given means no cityReason fact (never on a measurable fact). Lets this tie back to a real city and, when hotel-related, surface that city's real review summary — without you needing to name the city again in the statement text for the app to find it.",
              properties: {
                code: { type: "string", description: "The real city code this reason is about — must match a city-sentiment fact already on file." },
                category: { type: "string", enum: ["weather", "people", "hotel", "layover-length", "downtime", "other"] },
              },
              required: ["code", "category"],
            },
            recurringWeekday: {
              type: "string",
              enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
              description:
                "Only for a qualitative fact describing a commitment that recurs on the SAME day every week (a standing Tuesday practice, a weekly appointment) — never a one-off date (use specificDates for that), a holiday, or 'sometime this month.' This lets the results screen check the real weekday against each line's actual calendar and flag a genuine conflict. Omit for anything not literally weekly-recurring, including a vague 'I have plans some days' with no specific day named.",
            },
            specificDates: {
              type: "array",
              items: { type: "string" },
              description:
                "Only for a qualitative fact about specific calendar days the pilot needs off (a wedding on the 14th, a checkride, 'the 9th through the 11th') — each day as YYYY-MM-DD, every day of a range listed separately. Resolve 'the 14th' or 'Halloween' against groundingStats.bidPeriod (its start/end dates); if you can't tell which real date they mean, ask rather than guess, and omit this field. The results screen checks each date against every line's real calendar and flags a line that works it.",
            },
          },
          required: ["statement", "kind", "confidence", "importance"],
        },
      },
      required: ["op"],
    },
  } as const;
}


export function buildTurnTool(canWrapUp: boolean): Anthropic.Tool {
  return {
  name: "submit_interview_turn",
  description: canWrapUp
    ? "Submit this turn's decision: either the next question to ask, or a decision to wrap up the interview, plus any updates to the pilot's profile learned from their last answer."
    : "Submit this turn's decision: the next question to ask (wrapping up is not available yet — there's still real, required ground to cover), plus any updates to the pilot's profile learned from their last answer.",
  input_schema: {
    type: "object",
    // Order matters: the model writes these top to bottom, so it reads the
    // pilot's last answer (heard), records it (profileUpdates), and thinks
    // (reasoning) before it ever writes the next question. Live, with the
    // question first, whole answers went unrecorded while it raced ahead.
    properties: {
      heard: {
        type: "string",
        description:
          "First, before anything else: one short line (under 20 words) saying back what the pilot's LAST answer told you — the gist in your own plain words, in their register, never a quote and never a claim they didn't make. The pilot sees it above your next question, so it must be exactly right. Empty string only when there is no previous answer yet.",
      },
      profileUpdates: profileUpdatesSchemaProperty(),
      reasoning: {
        type: "string",
        description: "Internal-only: why you chose this action. Never shown to the pilot.",
      },
      action: canWrapUp ? { type: "string", enum: ["ask", "wrap_up"] } : { type: "string", enum: ["ask"] },
      // Not nullable while wrapping isn't allowed: live, a model with every
      // gate clear but the floor not yet reached sent `"question": null`
      // twice in a row rather than finding one more thing worth asking.
      question: {
        type: canWrapUp ? ["object", "null"] : "object",
        description: canWrapUp ? "Required when action is 'ask'; null when action is 'wrap_up'." : "Required — wrapping up isn't available yet, so this is always a real question.",
        properties: {
          kind: { type: "string", enum: ["slider", "target-slider", "choice", "free-text"] },
          topic: {
            type: "string",
            enum: QUESTION_TOPICS,
            description:
              "The ONE topic-backlog subject this question is about (\"closing\" for the final anything-I-missed check, \"other\" only if nothing fits). One question, one topic — if you find yourself wanting a second topic, that's the next question.",
          },
          prompt: { type: "string", description: "The question text itself, in pilot voice — one question, never two joined by \"and separately\"." },
          helpText: { type: "string", description: "Optional one-line context shown under the prompt." },
          boundTo: {
            type: "string",
            description:
              "Required for kind 'slider' or 'target-slider'. For 'slider', must be one of the EXPLICIT-WEIGHT ids (never 'dutyPeriods', never an implicit id). For 'target-slider', must be one of the EXPLICIT-TARGET ids (daysOff, creditHours, dutyPeriods, circadianTolerance, or tripLength) — see the system prompt's catalog section for the exact lists.",
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
              "Only for kind 'target-slider' on 'daysOff', 'dutyPeriods' or 'tripLength' when you're building a tolerance band (floor/ideal/ceiling) instead of one pinned number — see the system prompt's range-target guidance. Omit entirely for a plain single-number target-slider (including any 'creditHours' target-slider, which never gets range treatment).",
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
        required: ["kind", "topic", "prompt"],
      },
    },
    // "question" is required at this top level even though it's legitimately
    // null for a wrap_up (its own type already allows ["object", "null"]) —
    // a live-tested failure at scale (41% of turns in a stress test with a
    // large bidStory context) showed the model omitting "question" entirely
    // on an "ask" response when it wasn't in this list, not from hitting the
    // output token ceiling (well under budget every time it happened) but
    // from the field simply reading as skippable. Listing it here is a much
    // stronger signal than the field's own description alone.
    required: ["heard", "profileUpdates", "action", "question"],
  },
  };
}

/**
 * The turn's user message, as two blocks: what stays the same for a whole
 * interview (the bid pack's numbers, the catalog ids, the pilot's own story)
 * first, marked for caching, then what changes every turn. With the system
 * prompt also cached, a turn re-sends only the second block at full price.
 */
function buildUserContent(body: TurnRequestBody, extraNote?: string): Anthropic.TextBlockParam[] {
  const catalogIds = new Set(allKnownVariableDescriptors().map((d) => d.id));
  const perInterview = JSON.stringify({
    bidPack: { base: body.base, aircraft: body.aircraft },
    groundingStats: body.grounding,
    isCommuter: body.isCommuter,
    validCatalogIds: Array.from(catalogIds),
    // The pilot's own bidding-story answer, if they gave one — for how
    // questions get WRITTEN (rule 9 in interview-prompt.ts), and as the
    // place to check before asking about something they already covered.
    bidStory: body.bidStory,
    // Where a commuter commutes from — known, so never asked; a layover there is a night at home.
    commuteFrom: body.commuteFrom,
    // What the fleet has learned about pilots in this one's group — how to spend questions, never something to repeat to them.
    populationInsights: body.populationInsights,
  });
  const perTurn = JSON.stringify({
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
    uncoveredExplicitWeightIds: body.uncoveredExplicitWeightIds,
    minTurnsBeforeWrap: body.minTurnsBeforeWrap,
    openEssentials: body.openEssentials,
    closingAllowed: body.closingAllowed,
    seniorityKnown: body.seniorityKnown,
    // Which topics have already had a question, in order — so the next one doesn't circle back to a finished subject.
    topicsAsked: body.transcript.map((t) => t.question.topic ?? "other"),
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
    // A rotating anonymous cross-pilot sample, purely for phrasing (rule 10).
    styleSample: body.styleSample,
  });
  return [
    { type: "text", text: perInterview, cache_control: { type: "ephemeral" } },
    { type: "text", text: extraNote ? `${perTurn}\n\n${extraNote}` : perTurn },
  ];
}

/** "dutyPeriods" is deliberately excluded — it's target-only (see `ExplicitTargetKey`), not a dimension the interview can bind directionally the same way a real bipolar/magnitude slider works. */
const PREFERENCE_WEIGHTS_KEYS = new Set(Object.keys(DEFAULT_WEIGHTS).filter((k) => k !== "dutyPeriods"));

function isPreferenceWeightsKey(key: unknown): key is ExplicitWeightKey {
  return typeof key === "string" && PREFERENCE_WEIGHTS_KEYS.has(key);
}

function isExplicitTargetKey(key: unknown): key is ExplicitTargetKey {
  return typeof key === "string" && (EXPLICIT_TARGET_KEYS as string[]).includes(key);
}

/** Only "daysOff"/"dutyPeriods" ever get range treatment — a rangeRole on "creditHours" (or a garbage value) is silently dropped rather than rejecting the whole fact/question over it. */
const RANGE_TARGET_KEYS = new Set<ExplicitTargetKey>(["daysOff", "dutyPeriods", "tripLength"]);

function parseRangeRole(key: ExplicitTargetKey, raw: unknown): "min" | "ideal" | "max" | undefined {
  if (!RANGE_TARGET_KEYS.has(key)) return undefined;
  return raw === "min" || raw === "ideal" || raw === "max" ? raw : undefined;
}

const IMPLICIT_VARIABLE_IDS = new Set(IMPLICIT_VARIABLES.map((v) => v.id));

function isKnownVariableId(id: unknown): boolean {
  return typeof id === "string" && IMPLICIT_VARIABLE_IDS.has(id);
}

/** Validates and reconstructs one raw `measurable` object from the tool input into a real `MeasurableBinding`, or undefined if it doesn't hold up against the real catalog — the runtime allowlist check tool-schema conformance alone doesn't guarantee, the same spirit as `classify-preference`'s existing `validVariableIds` check. */
export function parseMeasurableBinding(raw: unknown): PreferenceFact["measurable"] {
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

const WEEKDAY_ABBREVIATIONS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

function parseRecurringWeekday(raw: unknown): PreferenceFact["recurringWeekday"] {
  return typeof raw === "string" && WEEKDAY_ABBREVIATIONS.has(raw) ? (raw as PreferenceFact["recurringWeekday"]) : undefined;
}

/** Real YYYY-MM-DD dates only (a month has no Feb 30), deduplicated and capped — anything else is dropped rather than checked against a line as if it were a day. */
export function parseSpecificDates(raw: unknown): string[] | undefined {
  const list = decodeIfJsonText(raw);
  if (!Array.isArray(list)) return undefined;
  const dates = [
    ...new Set(
      list.filter((d): d is string => {
        if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
        const parsed = new Date(`${d}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
      })
    ),
  ].slice(0, 62);
  return dates.length > 0 ? dates : undefined;
}

/** Fallback unit labels when the model mislabels a target-only id as a "slider" (see the coercion in `parseQuestion` below) and so never supplied its own unitSingular/unitPlural. */
const TARGET_UNIT_LABELS: Record<ExplicitTargetKey, [string, string]> = {
  daysOff: ["day off", "days off"],
  creditHours: ["hour", "hours"],
  dutyPeriods: ["duty period", "duty periods"],
  circadianTolerance: ["consecutive report", "consecutive reports"],
  tripLength: ["day", "days"],
};

/**
 * With a large nested tool schema the model now and then sends an array or
 * object field as its JSON text ("[{\"op\": ...}]") rather than as the value
 * itself. Reading only a real array used to turn that into zero updates —
 * a pilot's whole bidding story silently extracting to nothing.
 */
function decodeIfJsonText(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text.startsWith("[") && !text.startsWith("{")) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

/** A real question, not a stub — live, the model twice sent `{"kind":"slider","prompt":"placeholder"}` under schema pressure. */
function isRealPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return text.length >= 12 && !/^(placeholder|todo|tbd|question)\b/i.test(text);
}

export function parseQuestion(rawInput: unknown): InterviewQuestion | null {
  const raw = decodeIfJsonText(rawInput);
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.prompt !== "string" || !isRealPrompt(q.prompt)) return null;
  const id = crypto.randomUUID();
  const helpText = typeof q.helpText === "string" ? q.helpText : undefined;
  const topic = typeof q.topic === "string" && QUESTION_TOPICS.includes(q.topic) ? q.topic : "other";

  // The model occasionally mislabels a target-only id (dutyPeriods, or
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
      topic,
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
    return { id, kind: "slider", prompt: q.prompt, helpText, topic, boundTo: q.boundTo, lowLabel: q.lowLabel, highLabel: q.highLabel, centerLabel: q.centerLabel };
  }
  if (q.kind === "target-slider" && isExplicitTargetKey(q.boundTo)) {
    if (typeof q.unitSingular !== "string" || typeof q.unitPlural !== "string") return null;
    return {
      id,
      kind: "target-slider",
      prompt: q.prompt,
      helpText,
      topic,
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
    return { id, kind: "choice", prompt: q.prompt, helpText, topic, options };
  }
  if (q.kind === "free-text") {
    return { id, kind: "free-text", prompt: q.prompt, helpText, topic, placeholder: typeof q.placeholder === "string" ? q.placeholder : undefined };
  }
  return null;
}

/** Below this, an explicit-weight fact's importance means "doesn't matter" and is stored as exactly 0 — see its use in `parseProfileUpdates`. */
export const INDIFFERENT_IMPORTANCE = 0.2;

/** Individual bad profile updates are dropped rather than failing the whole turn — the question the pilot needs to keep going is the critical part of the response; losing one mis-shaped fact is low-stakes by comparison. */
export function parseProfileUpdates(rawInput: unknown, turnIndex: number, answeredQuestionId: string | undefined): PreferenceFactUpdate[] {
  const raw = decodeIfJsonText(rawInput);
  if (!Array.isArray(raw)) return [];
  const updates: PreferenceFactUpdate[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const u = item as Record<string, unknown>;

    if (u.op === "retire" && typeof u.factId === "string") {
      updates.push({ op: "retire", factId: u.factId });
      continue;
    }

    const rawFact = decodeIfJsonText(u.fact);
    if ((u.op === "add" || u.op === "revise") && rawFact && typeof rawFact === "object") {
      const f = rawFact as Record<string, unknown>;
      if (typeof f.statement !== "string" || !f.statement.trim()) continue;
      if (f.kind !== "measurable" && f.kind !== "qualitative") continue;
      if (typeof f.confidence !== "number" || typeof f.importance !== "number") continue;

      const measurable = f.kind === "measurable" ? parseMeasurableBinding(decodeIfJsonText(f.measurable)) : undefined;
      if (f.kind === "measurable" && !measurable) continue; // claimed measurable but didn't bind to anything real — drop rather than silently score against nothing.

      // Honored on explicit-weight/implicit-weight/city-sentiment always,
      // and on explicit-target ONLY when rangeRole is "min" or "max" — a
      // stated floor or ceiling has a real violation condition (falling
      // below it / exceeding it); a bare pinned "ideal" number doesn't, so
      // the flag is dropped rather than the whole fact (same spirit as
      // dropping a bad `measurable` above: lose the part that doesn't hold
      // up, not the turn). A qualitative fact can be one only when it carries
      // something a line can actually violate: dates or a weekday it needs off.
      const recurringWeekday = f.kind === "qualitative" ? parseRecurringWeekday(f.recurringWeekday) : undefined;
      const specificDates = f.kind === "qualitative" ? parseSpecificDates(f.specificDates) : undefined;
      const severity =
        f.severity === "dealbreaker" &&
        ((measurable &&
          (measurable.type === "explicit-weight" ||
            measurable.type === "implicit-weight" ||
            measurable.type === "city-sentiment" ||
            (measurable.type === "explicit-target" && (measurable.rangeRole === "min" || measurable.rangeRole === "max")))) ||
          (f.kind === "qualitative" && (recurringWeekday || specificDates)))
          ? ("dealbreaker" as const)
          : undefined;

      // An explicit preference read at under 0.2 importance is the model's
      // way of writing "doesn't really matter" — and any value above 0 is
      // shown to the pilot as a lean (an amenity as "matters to you," a
      // slider nudged off center). Live-tested: "report time's not a big
      // deal" came back as +20 toward late shows, "I don't eat hotel food
      // much" as food mattering 15. Below this floor it's genuinely 0.
      const rawImportance = Math.min(1, Math.max(0, f.importance));
      const importance = measurable?.type === "explicit-weight" && rawImportance < INDIFFERENT_IMPORTANCE ? 0 : rawImportance;

      const fact: PreferenceFact = {
        id: u.op === "revise" && typeof f.id === "string" ? f.id : crypto.randomUUID(),
        statement: f.statement,
        kind: f.kind,
        measurable,
        confidence: Math.min(1, Math.max(0, f.confidence)),
        importance,
        severity,
        source: answeredQuestionId
          ? { kind: "adaptive-question", questionId: answeredQuestionId }
          : { kind: "adaptive-question", questionId: "turn-1" },
        turnIndex,
        // Only meaningful on a qualitative fact — never on a measurable one, which already has its own real binding.
        cityReason: f.kind === "qualitative" ? parseCityReason(f.cityReason) : undefined,
        recurringWeekday,
        specificDates,
      };
      updates.push({ op: u.op, fact });
    }
  }

  return updates;
}

export type InterviewTurnResult = { ok: true; turn: TurnResponse } | { ok: false; error: string };

/** One model call's token counts — passed to an optional observer so an evaluation script can measure cost and cache hits without scraping logs. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** One Anthropic call for one turn attempt — factored out so a malformed response below the floor (see below) can be retried with a corrective note rather than duplicating the whole call. */
async function requestTurnFromModel(
  client: Anthropic,
  req: TurnRequestBody,
  canWrapUp: boolean,
  extraNote?: string,
  onUsage?: (usage: TurnUsage) => void
): Promise<Record<string, unknown> | null> {
  const response = await createToolCall(client, {
    // Observed reasoning fields alone running 600-900 output tokens once the
    // interview reaches contradiction-resolution territory (Phase 6 transcript
    // testing) — 1500 left too little headroom, and a truncated tool call means
    // a lost turn (parseQuestion sees an incomplete/missing question object).
    max_tokens: 2200,
    // The system prompt is the same for every turn of every interview, so it
    // (and the tool definition ahead of it) is cached rather than re-read
    // in full ~30 times per pilot.
    system: [{ type: "text", text: buildInterviewSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserContent(req, extraNote) }],
    tools: [buildTurnTool(canWrapUp)],
  }, "submit_interview_turn");

  console.log("[interview-turn] usage", {
    turnsUsed: req.turnsUsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    retry: !!extraNote,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  });
  onUsage?.({
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  return toolUse ? (toolUse.input as Record<string, unknown>) : null;
}

/**
 * The tool schema can't express "question is required when action is 'ask'"
 * as a hard constraint — the model sometimes returns action "ask" with no
 * question object, or (live) a stub like `{"kind":"slider","prompt":"placeholder"}`.
 * Before wrapping is allowed, that must never be read as a wrap-up: caught
 * live, the gap once silently ended a real pilot's interview after 5 turns.
 */
const MISSING_QUESTION_RETRY_NOTE =
  "IMPORTANT: your previous response had action \"ask\" but no valid \"question\" object. Wrapping up is not available yet — you must return action \"ask\" with a complete, real question: \"topic\" and \"prompt\" are always required (a real question, never a placeholder), plus lowLabel/highLabel/centerLabel/boundTo for kind \"slider\", unitSingular/unitPlural/boundTo for kind \"target-slider\", or at least 2 \"options\" for kind \"choice\". A kind \"free-text\" question only ever needs topic and prompt — use that if nothing else fits.";

/** Whether a new measurable fact says exactly what one already on file says — same binding, same direction/number/sentiment, same strength. */
function restatesMeasurable(a: PreferenceFact, b: PreferenceFact): boolean {
  const x = a.measurable;
  const y = b.measurable;
  if (!x || !y || x.type !== y.type || Math.abs(a.importance - b.importance) > 0.05 || a.severity !== b.severity) return false;
  if (x.type === "explicit-weight" && y.type === "explicit-weight") return x.key === y.key && x.direction === y.direction;
  if (x.type === "implicit-weight" && y.type === "implicit-weight") return x.variableId === y.variableId && x.direction === y.direction;
  if (x.type === "explicit-target" && y.type === "explicit-target") return x.key === y.key && x.value === y.value && x.rangeRole === y.rangeRole;
  if (x.type === "city-sentiment" && y.type === "city-sentiment") return x.code === y.code && x.sentiment === y.sentiment;
  return false;
}

const sameText = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Drops "add" updates that only repeat what's already on file. Live, once
 * told to record everything from each answer, the model began re-adding
 * facts it already had — a Saturday commitment restated three turns
 * running, one fact literally reading "Duplicate of the 14 duty-period
 * ceiling fact." A real change (a new strength, a new number, a dealbreaker
 * added or dropped) is never an exact restatement, so it always survives.
 */
export function dropRestatedFacts(updates: PreferenceFactUpdate[], existing: PreferenceFact[]): PreferenceFactUpdate[] {
  return updates.filter((u) => {
    if (u.op !== "add") return true;
    const f = u.fact;
    if (f.kind === "measurable") return !existing.some((e) => e.kind === "measurable" && restatesMeasurable(f, e));
    return !existing.some(
      (e) =>
        e.kind === "qualitative" &&
        e.severity === f.severity &&
        e.recurringWeekday === f.recurringWeekday &&
        (sameText(e.statement, f.statement) || (!!f.recurringWeekday && Math.abs(e.importance - f.importance) <= 0.05 && !f.specificDates && !e.specificDates))
    );
  });
}

/** An answer long enough that recording nothing from it means the extraction was skipped, not that the pilot said nothing. */
const SUBSTANTIVE_ANSWER_CHARS = 80;

const MISSED_EXTRACTION_RETRY_NOTE =
  "IMPORTANT: the pilot's last answer said something real, and your previous response recorded nothing from it in profileUpdates. Read that answer again and record what it actually says — a measurable fact where it matches the catalog, a qualitative fact (in their words) where it doesn't, a \"revise\" where it changes something already in currentFacts. Only if it genuinely adds nothing new may profileUpdates stay empty.";

/** The text a pilot actually wrote in their last answer — a free-text answer, or the note they added to a slider/number/choice. */
function lastAnswerText(answer: InterviewAnswer | undefined): string {
  if (!answer) return "";
  if (answer.kind === "free-text") return answer.text;
  return "elaboration" in answer && answer.elaboration ? answer.elaboration : "";
}

/**
 * Merges the client-side reading of a slider/number answer with the model's
 * own extraction. The pilot's own slider position is the truth about how
 * strongly they feel — live, a pilot set risk tolerance at -30 and pay at
 * -45 with a short note, and the model's reading of that note turned them
 * into -70 and -80. So the exact answer is appended last (it wins, via
 * `finalizeAdaptiveProfile`'s last-fact-per-key rule), unless the pilot's
 * own note points the other way from the slider (the model, having read the
 * note, disagreed on direction) — then the words win.
 */
export function mergeDeterministicFact(updates: PreferenceFactUpdate[], deterministic: PreferenceFact, hasElaboration: boolean): PreferenceFactUpdate[] {
  const d = deterministic.measurable;
  if (!d) return updates;
  const modelFacts = updates.flatMap((u) => (u.op !== "retire" && u.fact.measurable?.type === d.type ? [u.fact] : []));

  if (d.type === "explicit-target") {
    // A number answer pins the value exactly; how much it matters comes from
    // the model's reading of everything they've said about it (a flat 0.7
    // would undercut "that's the whole game" at 0.95).
    const reading = modelFacts.find(
      (f) => f.measurable?.type === "explicit-target" && f.measurable.key === d.key && f.measurable.rangeRole === d.rangeRole
    );
    const fact = reading ? { ...deterministic, importance: Math.max(reading.importance, deterministic.importance), severity: reading.severity } : deterministic;
    return [...updates, { op: "add", fact }];
  }

  if (d.type !== "explicit-weight") return [...updates, { op: "add", fact: deterministic }];
  const sameKey = modelFacts.filter((f) => f.measurable?.type === "explicit-weight" && f.measurable.key === d.key);
  // The pilot's own words point the other way from the slider: the words win.
  if (hasElaboration && sameKey.some((f) => f.measurable?.type === "explicit-weight" && f.measurable.direction !== d.direction)) return updates;
  // The slider sets the strength; a refusal the pilot put in words ("never") still makes it a dealbreaker.
  const severity = sameKey.find((f) => f.severity)?.severity;
  return [...updates, { op: "add", fact: severity ? { ...deterministic, severity } : deterministic }];
}

/** Words that mean the question is announcing an end it can't promise — rule 4 in the system prompt. */
const COUNTDOWN = /\b(last (question|thing|one)|final (question|one)|one more)\b/i;
/** Two asks joined into one question — rule 1. */
const COMPOUND = /\band (separately|also|on the flip side)\b|\?[^?]+\?/i;

/**
 * One structured line per turn — retries, duplicates dropped, and the
 * question-craft slips this test found (compound asks, countdown words,
 * length) — so how the interview behaves with real pilots shows up in the
 * server logs without paying for another simulated run. Contains no pilot
 * words, only counts and flags.
 */
function logTurnMetrics(
  req: TurnRequestBody,
  action: "ask" | "wrap_up",
  question: InterviewQuestion | null,
  updates: PreferenceFactUpdate[],
  heard: string | undefined,
  m: { extractionRetry: boolean; questionRetry: boolean; fallbackQuestion: boolean; droppedRestated: number }
) {
  const prompt = question?.prompt ?? "";
  console.log(
    "[interview-turn] metrics",
    JSON.stringify({
      turn: req.turnsUsed,
      action,
      floor: req.minTurnsBeforeWrap,
      uncovered: req.uncoveredExplicitWeightIds.length,
      essentials: req.openEssentials.length,
      kind: question?.kind,
      topic: question?.topic,
      words: prompt ? prompt.split(/\s+/).length : 0,
      compound: COMPOUND.test(prompt),
      countdown: COUNTDOWN.test(prompt),
      added: updates.filter((u) => u.op === "add").length,
      revised: updates.filter((u) => u.op === "revise").length,
      dealbreakers: updates.filter((u) => u.op !== "retire" && u.fact.severity === "dealbreaker").length,
      heard: !!heard,
      ...m,
    })
  );
}

export async function runInterviewTurn(
  apiKey: string,
  req: TurnRequestBody,
  onUsage?: (usage: TurnUsage) => void
): Promise<InterviewTurnResult> {
  const client = new Anthropic({ apiKey });
  // Structural, not just prose: until the story-adjusted floor is reached
  // AND every gate is clear (catalog coverage, the essential conversations),
  // "wrap_up" is dropped from the tool schema's own enum (see buildTurnTool)
  // so the model cannot select it no matter how the conversation reads. The
  // soft cap is the escape hatch: a pilot who won't engage with a couple of
  // ids, or a model that never tags its closing question, can't trap the
  // loop until the hard ceiling.
  const pastFloor = req.turnsUsed >= req.minTurnsBeforeWrap;
  const gatesClear = req.uncoveredExplicitWeightIds.length === 0 && req.openEssentials.length === 0;
  const pastSoftCap = req.turnsUsed >= req.softCapTurns;
  const canWrapUp = pastFloor && (gatesClear || pastSoftCap);
  const lastTurn = req.transcript[req.transcript.length - 1];
  const answeredQuestionId = lastTurn?.question.id;
  const answerText = lastAnswerText(lastTurn?.answer);

  const metrics = { extractionRetry: false, questionRetry: false, fallbackQuestion: false, droppedRestated: 0 };

  try {
    let input = await requestTurnFromModel(client, req, canWrapUp, undefined, onUsage);
    if (!input) {
      return { ok: false, error: "Couldn't read the interview response." };
    }

    // A real answer that came back with nothing recorded from it is a
    // skipped extraction, not an empty answer — live, whole answers went
    // unrecorded for several turns at a time. One corrective retry.
    if (
      answerText.trim().length >= SUBSTANTIVE_ANSWER_CHARS &&
      dropRestatedFacts(parseProfileUpdates(input.profileUpdates, req.turnsUsed, answeredQuestionId), req.facts).length === 0
    ) {
      console.warn("[interview-turn] substantive answer produced no updates, retrying once", { turnsUsed: req.turnsUsed });
      metrics.extractionRetry = true;
      const retryInput = await requestTurnFromModel(client, req, canWrapUp, MISSED_EXTRACTION_RETRY_NOTE, onUsage);
      if (retryInput) input = retryInput;
    }

    // The tool schema itself excludes "wrap_up" from the enum when !canWrapUp
    // (see buildTurnTool), so this shouldn't be reachable — but the schema is
    // a strong steer, not a runtime guarantee, so it's re-checked here rather
    // than trusted blindly.
    if (input.action === "wrap_up" && !canWrapUp) {
      console.warn("[interview-turn] model returned wrap_up despite a restricted tool schema", {
        turnsUsed: req.turnsUsed,
        pastFloor,
        uncoveredCount: req.uncoveredExplicitWeightIds.length,
        openEssentials: req.openEssentials,
      });
    }
    const action = input.action === "wrap_up" && canWrapUp ? "wrap_up" : "ask";
    let question = action === "ask" ? parseQuestion(input.question) : null;

    if (action === "ask" && !question && !canWrapUp) {
      console.warn("[interview-turn] ask action with no valid question before wrap-up is allowed, retrying once", { turnsUsed: req.turnsUsed, rawQuestion: JSON.stringify(input.question) });
      metrics.questionRetry = true;
      const retryInput = await requestTurnFromModel(client, req, canWrapUp, MISSING_QUESTION_RETRY_NOTE, onUsage);
      if (retryInput) {
        // Keep whatever the first response extracted if the retry didn't redo it.
        if (parseProfileUpdates(retryInput.profileUpdates, req.turnsUsed, answeredQuestionId).length === 0) {
          retryInput.profileUpdates = input.profileUpdates;
        }
        input = retryInput;
        question = parseQuestion(input.question);
      }
    }

    const parsedUpdates = parseProfileUpdates(input.profileUpdates, req.turnsUsed, answeredQuestionId);
    let profileUpdates = dropRestatedFacts(parsedUpdates, req.facts);
    metrics.droppedRestated = parsedUpdates.length - profileUpdates.length;
    const reasoning = typeof input.reasoning === "string" ? input.reasoning : undefined;
    const heard = typeof input.heard === "string" && input.heard.trim() && lastTurn ? input.heard.trim() : undefined;

    // The pilot's own slider/number answer, read exactly — see mergeDeterministicFact.
    if (lastTurn) {
      const deterministicFact = deterministicFactFromAnswer(lastTurn.question, lastTurn.answer, req.turnsUsed);
      if (deterministicFact) {
        const hasElaboration = "elaboration" in lastTurn.answer && !!lastTurn.answer.elaboration?.trim();
        profileUpdates = mergeDeterministicFact(profileUpdates, deterministicFact, hasElaboration);
      }
    }

    if (action === "wrap_up") {
      logTurnMetrics(req, "wrap_up", null, profileUpdates, heard, metrics);
      return { ok: true, turn: { action: "wrap_up", question: null, profileUpdates, reasoning, heard } };
    }

    if (!question) {
      if (!canWrapUp) {
        // The retry above also failed to produce a valid question — never
        // end the interview this early over a malformed response. A generic,
        // always-valid free-text question keeps the loop going.
        question = {
          id: crypto.randomUUID(),
          kind: "free-text",
          topic: "other",
          prompt: "What else about your ideal schedule should I know before I put together your ranking?",
        };
        metrics.fallbackQuestion = true;
      } else {
        // Once wrapping is allowed, a model that couldn't produce a valid
        // question was genuinely ambivalent about asking anything further.
        console.warn("[interview-turn] ask action with no valid question, treating as wrap_up", { turnsUsed: req.turnsUsed, rawQuestion: JSON.stringify(input.question) });
        logTurnMetrics(req, "wrap_up", null, profileUpdates, heard, metrics);
        return { ok: true, turn: { action: "wrap_up", question: null, profileUpdates, reasoning, heard } };
      }
    }

    logTurnMetrics(req, "ask", question, profileUpdates, heard, metrics);
    return { ok: true, turn: { action: "ask", question, profileUpdates, reasoning, heard } };
  } catch (e) {
    console.error("[interview-turn] request failed", e);
    return { ok: false, error: "Couldn't reach the interview service." };
  }
}

/**
 * The bidding-story extraction tool — a different job from `buildTurnTool`
 * above (exhaustive one-shot extraction over a long narrative, no "next
 * question" to decide), so it's a separate tool rather than a variant, but
 * shares the exact same `profileUpdates` shape (`profileUpdatesSchemaProperty`)
 * so a fact extracted here is indistinguishable from one extracted turn by
 * turn. The two new fields are this call's whole other job: capturing how
 * the pilot writes, for the anonymous cross-pilot style corpus (see
 * `server/style-store.ts`) — never returned to any client, only ever stored
 * server-side by the caller.
 */
function buildStoryExtractionTool(): Anthropic.Tool {
  return {
    name: "submit_bidding_story_extraction",
    description: "Submit every preference you extracted from the pilot's bidding-story answer, plus anonymized material capturing how they write.",
    input_schema: {
      type: "object",
      properties: {
        profileUpdates: profileUpdatesSchemaProperty(),
        styleSamplePhrases: {
          type: "array",
          description: "2-5 short, scrubbed phrases capturing this pilot's vocabulary/rhythm/formality — never a full sentence lifted from their actual answer, never anything identifying (no base/city/aircraft names, no numbers, no named people). Fewer (even zero) is fine if the answer is too short to responsibly generalize from.",
          items: { type: "string" },
        },
        styleTags: {
          type: "array",
          description: "A few one- or two-word style descriptors, e.g. \"terse\", \"dry humor\", \"heavy jargon\", \"formal\", \"self-deprecating\".",
          items: { type: "string" },
        },
        commuterStatus: {
          type: "string",
          enum: ["commuter", "local", "unknown"],
          description: "Whether the story says the pilot commutes to this base from elsewhere, lives in base, or doesn't say.",
        },
        commuteFrom: {
          type: "string",
          description: "For a commuter, the 3-letter airport code of the city they commute FROM, when the story says it (\"I commute from Charlotte\" -> \"CLT\", \"flying in from Denver\" -> \"DEN\"). Empty string when it isn't stated or they aren't a commuter — never guess.",
        },
      },
      required: ["profileUpdates", "styleSamplePhrases", "styleTags", "commuterStatus"],
    },
  };
}

function buildStoryUserMessage(req: BiddingStoryRequestBody): string {
  return JSON.stringify(
    {
      bidStoryText: req.bidStoryText,
      groundingStats: req.grounding,
      bidPack: { base: req.base, aircraft: req.aircraft },
      isCommuter: req.isCommuter,
      validCatalogIds: Array.from(new Set(allKnownVariableDescriptors().map((d) => d.id))),
      validCityCodes: req.cityCodes,
    },
    null,
    0
  );
}

export type BiddingStoryExtractionResult =
  | { ok: true; profileUpdates: PreferenceFactUpdate[]; styleSamplePhrases: string[]; styleTags: string[]; commuterStatus: boolean | null; commuteFrom: string | null }
  | { ok: false; error: string };

/** Bounds so one adversarial or malformed response can't produce absurdly long stored style material. */
const MAX_STYLE_PHRASE_LENGTH = 200;
const MAX_STYLE_TAG_LENGTH = 40;

/** A story this long always says something extractable — an empty result from one is a failed read, not an empty story. */
const MIN_STORY_CHARS_EXPECTING_FACTS = 120;

async function requestStoryExtraction(
  client: Anthropic,
  req: BiddingStoryRequestBody,
  onUsage?: (usage: TurnUsage) => void
): Promise<Record<string, unknown> | null> {
  const response = await createToolCall(client, {
    // A detailed, "every small detail" narrative can produce many more
    // extracted facts in one response than a single normal turn ever
    // does — the normal turn budget (2200) is too tight for this call.
    max_tokens: 6000,
    system: [{ type: "text", text: buildBiddingStoryPrompt() }],
    messages: [{ role: "user", content: buildStoryUserMessage(req) }],
    tools: [buildStoryExtractionTool()],
  }, "submit_bidding_story_extraction");
  console.log("[interview-bidding-story] usage", {
    storyChars: req.bidStoryText.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
  });
  onUsage?.({
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });
  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  return toolUse ? (toolUse.input as Record<string, unknown>) : null;
}

export async function runBiddingStoryExtraction(
  apiKey: string,
  req: BiddingStoryRequestBody,
  onUsage?: (usage: TurnUsage) => void
): Promise<BiddingStoryExtractionResult> {
  const client = new Anthropic({ apiKey });
  try {
    let input = await requestStoryExtraction(client, req, onUsage);
    if (
      req.bidStoryText.trim().length >= MIN_STORY_CHARS_EXPECTING_FACTS &&
      parseProfileUpdates(input?.profileUpdates, 0, undefined).length === 0
    ) {
      console.warn("[interview-bidding-story] no facts from a real story, retrying once", {
        storyChars: req.bidStoryText.length,
        rawType: typeof input?.profileUpdates,
      });
      input = (await requestStoryExtraction(client, req, onUsage)) ?? input;
    }
    if (!input) return { ok: false, error: "Couldn't read the extraction response." };

    // Rewritten to a "seed-question" source (matching how the pre-loop city
    // picker's own facts are sourced — see `factsFromCityPreferences` in
    // `AdaptiveInterview.tsx`) rather than parseProfileUpdates' default
    // "adaptive-question" source, since this genuinely isn't a turn in the
    // adaptive loop — it happens before that loop's own turnsUsed exists.
    const profileUpdates = parseProfileUpdates(input.profileUpdates, 0, undefined).map((update) =>
      update.op === "retire"
        ? update
        : { ...update, fact: { ...update.fact, source: { kind: "seed-question" as const, questionKey: "bidding-story" } } }
    );

    const styleSamplePhrases = Array.isArray(input.styleSamplePhrases)
      ? input.styleSamplePhrases.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0 && p.length <= MAX_STYLE_PHRASE_LENGTH
        )
      : [];
    const styleTags = Array.isArray(input.styleTags)
      ? input.styleTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.length <= MAX_STYLE_TAG_LENGTH)
      : [];

    const commuterStatus = input.commuterStatus === "commuter" ? true : input.commuterStatus === "local" ? false : null;
    const commuteFrom = parseAirportCode(input.commuteFrom);

    return { ok: true, profileUpdates, styleSamplePhrases, styleTags, commuterStatus, commuteFrom };
  } catch (e) {
    console.error("[interview-bidding-story] request failed", e);
    return { ok: false, error: "Couldn't reach the interview service." };
  }
}
