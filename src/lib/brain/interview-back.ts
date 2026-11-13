import type { InterviewExchange } from "@/lib/brain/build-model";
import type { StepResponse } from "@/lib/brain/client";
import type { ThreadState } from "@/lib/brain/interviewer";
import type { LineChoice, PilotModel, TripChoice } from "@/types/pilot-model";

/** The interview as it stood before one answer: what the interview's Back goes back to. */
export interface Snapshot {
  exchanges: InterviewExchange[];
  threads: Record<string, ThreadState>;
  choices: LineChoice[];
  tripChoices: TripChoice[];
  pastTrades: string[];
  question: Extract<StepResponse, { done: false }>;
  turn: number;
  /** The model as it stood before this answer, and how much of the interview it had read. */
  model: PilotModel | null;
  builtUpTo: number;
}

/**
 * A snapshot as the draft keeps it, so Back still goes back through the answers given before a reload. Each list only
 * grows from one answer to the next (Back takes the newest off), so a snapshot's lists are the start of the draft's:
 * it keeps how long each was, not a copy. Most answers share a model (it's re-read every few), so the model is kept
 * once, by its place in the draft's list of them.
 */
export interface SavedBackStep {
  at: { exchanges: number; choices: number; tripChoices: number; pastTrades: number };
  question: Snapshot["question"];
  turn: number;
  threads: Record<string, ThreadState>;
  /** Its place in `backModels`; null for none. */
  model: number | null;
  builtUpTo: number;
}

export interface InterviewLists {
  exchanges: InterviewExchange[];
  choices: LineChoice[];
  tripChoices: TripChoice[];
  pastTrades: string[];
}

export function saveBack(history: Snapshot[]): { back: SavedBackStep[]; backModels: PilotModel[] } {
  const backModels: PilotModel[] = [];
  const back = history.map((s): SavedBackStep => {
    let model: number | null = null;
    if (s.model) {
      model = backModels.indexOf(s.model);
      if (model === -1) model = backModels.push(s.model) - 1;
    }
    return {
      at: { exchanges: s.exchanges.length, choices: s.choices.length, tripChoices: s.tripChoices.length, pastTrades: s.pastTrades.length },
      question: s.question,
      turn: s.turn,
      threads: s.threads,
      model,
      builtUpTo: s.builtUpTo,
    };
  });
  return { back, backModels };
}

const count = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * The snapshots back, from the draft's own lists. All or none: a step that doesn't fit those lists is from some other
 * draft, and Back to it would put the wrong answers on screen — then Back starts from the reload, as it used to.
 */
export function restoreBack(back: unknown, backModels: unknown, lists: InterviewLists): Snapshot[] {
  if (!Array.isArray(back)) return [];
  const models = Array.isArray(backModels) ? (backModels as PilotModel[]) : [];
  const out: Snapshot[] = [];
  let last = -1;
  for (const b of back as Partial<SavedBackStep>[]) {
    const at = b?.at;
    if (!at || !count(at.exchanges, lists.exchanges.length - 1) || !count(at.choices, lists.choices.length) || !count(at.tripChoices, lists.tripChoices.length) || !count(at.pastTrades, lists.pastTrades.length)) return [];
    // Each answer adds to the interview: an earlier step is shorter than the next.
    if (at.exchanges <= last) return [];
    last = at.exchanges;
    if (!b.question || typeof b.question !== "object" || typeof b.turn !== "number" || typeof b.builtUpTo !== "number" || !b.threads || typeof b.threads !== "object") return [];
    if (b.model !== null && b.model !== undefined && !models[b.model]) return [];
    out.push({
      exchanges: lists.exchanges.slice(0, at.exchanges),
      choices: lists.choices.slice(0, at.choices),
      tripChoices: lists.tripChoices.slice(0, at.tripChoices),
      pastTrades: lists.pastTrades.slice(0, at.pastTrades),
      question: b.question,
      turn: b.turn,
      threads: b.threads,
      model: b.model === null || b.model === undefined ? null : models[b.model],
      builtUpTo: b.builtUpTo,
    });
  }
  return out;
}
