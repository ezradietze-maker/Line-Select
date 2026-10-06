import { EXPLICIT_WEIGHT_IDS } from "@/lib/interview-engine";
import { QUESTION_TOPICS } from "@/lib/interview-topics";
import type { CommuteGroup, SeniorityBand } from "@/lib/learning/cohort";
import type { CorrectionEvent } from "@/lib/learning/interview-learning";
import type { Bucket, DimSource, InterviewOutcome, QuestionEvent } from "@/lib/learning/interview-outcome";
import type { RangeTarget } from "@/types/preferences";

/**
 * Strict checks on what pilots' browsers send the learning. It's open to
 * guests and the internet, so nothing is trusted: unknown fields are dropped,
 * numbers are bounded, strings are short labels from known lists. A record
 * that doesn't hold up is rejected whole rather than half-learned from.
 */

const EXPLICIT = new Set<string>(EXPLICIT_WEIGHT_IDS);
const SOURCES = new Set<DimSource>(["story", "asked", "assumed", "edited", "none"]);
const BUCKETS = new Set<Bucket>(["zero", "pos", "neg"]);
const COMMUTE = new Set<CommuteGroup>(["commuter", "local", "unknown"]);
const SENIORITY = new Set<SeniorityBand>(["senior", "middle", "junior", "unknown"]);
const KINDS = new Set(["slider", "target-slider", "choice", "free-text"]);
const TOPICS = new Set(QUESTION_TOPICS);
const TARGET_KEYS = new Set(["daysOff", "creditHours", "dutyPeriods", "circadianTolerance", "tripLength"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const label = (v: unknown, max = 12) => typeof v === "string" && /^[A-Za-z0-9 '_-]{1,40}$/.test(v) && v.length <= max;
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function range(v: unknown): RangeTarget | null {
  if (!isObj(v)) return null;
  const out: RangeTarget = {};
  for (const role of ["min", "ideal", "max"] as const) {
    const x = v[role];
    if (x === undefined) continue;
    if (!num(x, 0, 500)) return null;
    out[role] = x as number;
  }
  return Object.keys(out).length ? out : null;
}

export function parseInterviewOutcome(raw: unknown): InterviewOutcome | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.month !== "string" || !/^[A-Za-z]{3}\d{2}$/.test(raw.month)) return null;
  const c = raw.cohort;
  if (!isObj(c) || !label(c.base, 6) || !label(c.aircraft, 8) || !label(c.seat, 4) || !COMMUTE.has(c.commute as CommuteGroup) || !SENIORITY.has(c.seniority as SeniorityBand)) return null;
  if (raw.modelVersion !== null && !label(raw.modelVersion, 40)) return null;
  if (!isObj(raw.story) || typeof raw.story.provided !== "boolean" || !num(raw.story.facts, 0, 200)) return null;
  if (!num(raw.turns, 0, 60) || typeof raw.wrapped !== "boolean") return null;

  if (!isObj(raw.dims)) return null;
  const dims: InterviewOutcome["dims"] = {};
  for (const [dim, v] of Object.entries(raw.dims)) {
    if (!EXPLICIT.has(dim) || !isObj(v) || !num(v.w, -100, 100) || !SOURCES.has(v.src as DimSource)) return null;
    dims[dim] = { w: Math.round(v.w as number), src: v.src as DimSource };
  }

  const implicit: Record<string, number> = {};
  if (isObj(raw.implicit)) {
    for (const [id, v] of Object.entries(raw.implicit)) {
      if (!/^[A-Za-z]{3,60}$/.test(id) || !num(v, -1.5, 1.5)) return null;
      implicit[id] = v as number;
    }
  }

  const targets: InterviewOutcome["targets"] = {};
  if (isObj(raw.targets)) {
    for (const [key, v] of Object.entries(raw.targets)) {
      const r = range(v);
      if (!TARGET_KEYS.has(key) || !r) return null;
      targets[key as keyof InterviewOutcome["targets"]] = r;
    }
  }

  if (!isObj(raw.cities) || !num(raw.cities.loved, 0, 200) || !num(raw.cities.avoided, 0, 200)) return null;
  if (!Array.isArray(raw.dealbreakers) || raw.dealbreakers.length > 20 || !raw.dealbreakers.every((d) => typeof d === "string" && /^[A-Za-z-]{1,40}$/.test(d))) return null;

  const predictions: Record<string, Bucket> = {};
  if (!isObj(raw.predictions)) return null;
  for (const [dim, b] of Object.entries(raw.predictions)) {
    if (!EXPLICIT.has(dim) || !BUCKETS.has(b as Bucket)) return null;
    predictions[dim] = b as Bucket;
  }

  if (!Array.isArray(raw.questions) || raw.questions.length > 60) return null;
  const questions: QuestionEvent[] = [];
  for (const q of raw.questions) {
    if (!isObj(q) || !TOPICS.has(q.topic as string) || !KINDS.has(q.kind as string) || typeof q.skipped !== "boolean" || !num(q.chars, 0, 2000) || !num(q.added, 0, 30) || typeof q.elaboration !== "boolean") return null;
    if (q.boundTo !== undefined && !/^[A-Za-z]{2,40}$/.test(String(q.boundTo))) return null;
    questions.push({ topic: q.topic as string, kind: q.kind as QuestionEvent["kind"], boundTo: q.boundTo as string | undefined, skipped: q.skipped, chars: q.chars as number, added: q.added as number, elaboration: q.elaboration });
  }

  return {
    v: 1,
    month: (raw.month as string).toUpperCase(),
    cohort: { base: (c.base as string).toUpperCase(), aircraft: (c.aircraft as string).toUpperCase(), seat: (c.seat as string).toUpperCase(), commute: c.commute as CommuteGroup, seniority: c.seniority as SeniorityBand },
    modelVersion: raw.modelVersion as string | null,
    story: { provided: raw.story.provided, facts: raw.story.facts as number },
    turns: raw.turns as number,
    wrapped: raw.wrapped,
    dims,
    implicit,
    targets,
    cities: { loved: raw.cities.loved as number, avoided: raw.cities.avoided as number },
    dealbreakers: raw.dealbreakers as string[],
    predictions,
    questions,
  };
}

export function parseCorrections(raw: unknown): CorrectionEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;
  const out: CorrectionEvent[] = [];
  for (const e of raw) {
    if (!isObj(e) || !EXPLICIT.has(e.dim as string) || !["assumed", "story", "asked"].includes(e.src as string) || !num(e.from, -100, 100) || !num(e.to, -100, 100)) return null;
    out.push({ dim: e.dim as string, src: e.src as CorrectionEvent["src"], from: e.from as number, to: e.to as number });
  }
  return out;
}
