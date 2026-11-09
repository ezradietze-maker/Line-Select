import { failedCallCost, structuredCall } from "@/lib/brain/llm";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PilotModel } from "@/types/pilot-model";
import { avoidedPhrases, insteadOf } from "./pilot-words";

/**
 * The last check on what the brain wrote for the pilot to read: a word that's in neither the pack nor the ex-pilot's own
 * talk, and that this pilot didn't bring up themselves, is reworded before they see it. The brain is told not to write
 * them, and rarely does, so this usually costs nothing: a re-read would be dear, so only the lines at fault go to a cheap
 * model, a fraction of a cent. Never holds up the reading: if it fails, a priority's name falls back to its measure's own
 * name, which the tests keep clean, and the rest stands as written.
 */

export const FIX_WORDS_MODEL = "claude-haiku-5-5";

interface Line {
  id: string;
  text: string;
  /** Sets the reworded text on the model. */
  set: (m: PilotModel, text: string) => PilotModel;
}

/** The text the pilot reads, each with how to put a rewording back. */
function linesOf(model: PilotModel): Line[] {
  return [
    { id: "synopsis", text: model.synopsis, set: (m, text) => ({ ...m, synopsis: text }) },
    ...model.criteria.map((c): Line => ({ id: `criterion:${c.id}`, text: c.label, set: (m, text) => ({ ...m, criteria: m.criteria.map((x) => (x.id === c.id ? { ...x, label: text } : x)) }) })),
    ...model.threads.map((t): Line => ({ id: `thread:${t.id}`, text: t.topic, set: (m, text) => ({ ...m, threads: m.threads.map((x) => (x.id === t.id ? { ...x, topic: text } : x)) }) })),
  ];
}

const SYSTEM = `A bidding assistant wrote these lines for a FedEx pilot to read, and each has a word in it pilots here don't use. Reword each one so it means exactly the same, in the same voice and about the same length, using what's given in place of each word. Change nothing else. Keep every number, city and line as written.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: { lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } } } },
} as const;

export async function fixModelWords(model: PilotModel, theirs: string, opts: { apiKey?: string } = {}): Promise<{ model: PilotModel; costUsd: number }> {
  const faults = linesOf(model).filter((l) => avoidedPhrases(l.text, theirs).length);
  if (!faults.length) return { model, costUsd: 0 };
  const asked = faults.map((l) => `${l.id}: ${l.text}\n  ${avoidedPhrases(l.text, theirs).map((w) => `instead of "${w}", say ${insteadOf(w)}`).join("\n  ")}`).join("\n");

  let reworded = new Map<string, string>();
  let costUsd = 0;
  try {
    const { data, usage } = await structuredCall<{ lines: { id: string; text: string }[] }>({
      apiKey: opts.apiKey,
      model: FIX_WORDS_MODEL,
      system: SYSTEM,
      user: { fresh: asked },
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
      maxTokens: 2000,
    });
    costUsd = usage.costUsd;
    reworded = new Map(data.lines.map((l) => [l.id, l.text.trim()]));
  } catch (e) {
    costUsd = failedCallCost(e);
  }

  let fixed = model;
  for (const line of faults) {
    const text = reworded.get(line.id);
    if (text && !avoidedPhrases(text, theirs).length) {
      fixed = line.set(fixed, text);
      continue;
    }
    // Still wrong, or the call failed: a priority has its measure's own name to fall back on.
    const criterion = line.id.startsWith("criterion:") ? model.criteria.find((c) => `criterion:${c.id}` === line.id) : null;
    const name = criterion && METRICS_BY_ID.get(criterion.metric)?.label;
    if (name && !avoidedPhrases(name, theirs).length) fixed = line.set(fixed, name);
  }
  return { model: fixed, costUsd };
}
