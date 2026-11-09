import { structuredCall, type BrainUsage } from "@/lib/brain/llm";
import { neverSayForPrompt } from "@/lib/brain/pilot-words";

/**
 * A pilot's own words for why they swapped two lines, matched to something the brain can count: one of their
 * priorities, a measure they never named, or a reason a bid pack can't show. The language model only matches words to
 * a closed list it's given, with both lines' numbers; the learning itself stays in the numeric model
 * (`reorder-learner.ts`) — the split OPEN (Handa et al. 2024) and BED-LLM (2026) found works best. A cheap model at low
 * effort: it's a short matching task, a fraction of a cent.
 */

export const SWAP_REASON_MODEL = "claude-haiku-5-5";

/** One thing the pilot's words could mean, with each line's value as the pilot sees it. */
export interface ReasonOption {
  id: string;
  label: string;
  higher: string;
  lower: string;
}

export interface SwapReasonInput {
  text: string;
  higher: string;
  lower: string;
  /** Their priorities. */
  priorities: ReasonOption[];
  /** Measures they never named. */
  measures: ReasonOption[];
}

export interface SwapReason {
  kind: "priority" | "measure" | "notMeasurable" | "unclear";
  /** The priority's or measure's id. */
  id: string | null;
  /** For a measure: whether the pilot wants more of it or less. */
  direction: "more" | "less" | null;
  /** What the brain understood, in a few words, for saying back. */
  summary: string;
}

const SYSTEM = `A pilot reordered their bid lines: they put one line above another, and were asked why in their own words. Match what they wrote to ONE thing on the lists you're given.

- "priority": one of their priorities explains it. Give its id.
- "measure": a measure that isn't one of their priorities explains it. Give its id, and "more" or "less" for which way they want it.
- "notMeasurable": the reason is real but nothing on either list can show it (a city's hotel they dislike for a personal reason, a date with family that isn't a day off, a crew-member they fly with). Say it back in a few words.
- "unclear": you can't tell what they mean.

For "notMeasurable" and "unclear", give an empty id. Give "direction" only for a measure; otherwise "none". Pick from the lists only: never invent an id. Prefer a priority over a measure when both fit. Use the numbers: the reason they give should be one where the line they put higher really is better for them. If the two lines are the same on the thing they name, still match it — the app will say so. Keep "summary" under 15 words, in plain words, no jargon.

In summary: ${neverSayForPrompt()}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "direction", "summary"],
  properties: {
    kind: { type: "string", enum: ["priority", "measure", "notMeasurable", "unclear"] },
    // Plain strings: "" for no id, "none" for no direction (`cleanSwapReason` turns them into null).
    id: { type: "string" },
    direction: { type: "string", enum: ["more", "less", "none"] },
    summary: { type: "string" },
  },
} as const;

function listOf(options: ReasonOption[], higher: string, lower: string): string {
  return options.map((o) => `- ${o.id}: ${o.label} (line ${higher}: ${o.higher}; line ${lower}: ${o.lower})`).join("\n") || "(none)";
}

export async function readSwapReason(input: SwapReasonInput & { apiKey?: string }): Promise<{ reason: SwapReason; usage: BrainUsage }> {
  const { data, usage } = await structuredCall<SwapReason>({
    apiKey: input.apiKey,
    model: SWAP_REASON_MODEL,
    system: SYSTEM,
    user: {
      fresh: `They put line ${input.higher} above line ${input.lower}.\n\nTHEIR PRIORITIES:\n${listOf(input.priorities, input.higher, input.lower)}\n\nMEASURES THAT AREN'T THEIR PRIORITIES:\n${listOf(input.measures, input.higher, input.lower)}\n\nWHY, IN THEIR WORDS:\n${input.text}`,
    },
    schema: SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: 1000,
  });
  return { reason: cleanSwapReason(data, input), usage };
}

/** Only ids that were on the lists, a direction only for a measure — anything else the model wrote becomes "unclear". */
export function cleanSwapReason(r: SwapReason, input: Pick<SwapReasonInput, "priorities" | "measures">): SwapReason {
  const summary = String(r.summary ?? "").trim().slice(0, 160);
  if (r.kind === "priority" && input.priorities.some((o) => o.id === r.id)) return { kind: "priority", id: r.id, direction: null, summary };
  if (r.kind === "measure" && input.measures.some((o) => o.id === r.id) && (r.direction === "more" || r.direction === "less")) return { kind: "measure", id: r.id, direction: r.direction, summary };
  if (r.kind === "notMeasurable" && summary) return { kind: "notMeasurable", id: null, direction: null, summary };
  return { kind: "unclear", id: null, direction: null, summary };
}
