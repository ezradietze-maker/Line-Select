import type { InterviewQuestion, InterviewTurnRecord, PreferenceFact } from "@/types/interview-session";
import type { CitySentiment } from "@/types/preferences";

/**
 * An interview is a dozen or more questions of a pilot's own words — losing it to a
 * refresh, a dropped connection or a phone locking mid-way is the single
 * most expensive failure this flow can have. The answers-so-far live in this
 * one local record (same device, same as the rest of their data) so the
 * pilot can pick up exactly where they left off.
 */
export interface InterviewDraft {
  version: 1;
  bidPackId: string;
  savedAt: number;
  isCommuter: boolean | null;
  hasCrashPad: boolean | null;
  /** Where a commuter commutes from; absent on older drafts or when not given. */
  commuteFrom?: string;
  /** Absent on a draft saved before the interview asked for it. */
  seniorityNumber?: number | null;
  /** Absent on a draft saved before the bidding-story question existed, or when the pilot skipped it. */
  bidStoryText?: string;
  cityPreferences: Record<string, CitySentiment>;
  facts: PreferenceFact[];
  transcript: InterviewTurnRecord[];
  turnsUsed: number;
  currentQuestion: InterviewQuestion;
}

/** Old enough that resuming would be surprising (a bid cycle later, someone else's device) — dropped rather than offered. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function draftKey(userId: string | null): string {
  return `line-select:interview-draft:${userId ?? "guest"}:v1`;
}

/** Returns the draft only if it's the right shape, for this bid pack, and fresh — anything else is treated as no draft at all. */
export function parseDraft(raw: string | null, bidPackId: string, now: number): InterviewDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<InterviewDraft>;
    if (d.version !== 1) return null;
    if (d.bidPackId !== bidPackId) return null;
    if (typeof d.savedAt !== "number" || now - d.savedAt > DRAFT_MAX_AGE_MS || now < d.savedAt) return null;
    if (!Array.isArray(d.facts) || !Array.isArray(d.transcript)) return null;
    if (typeof d.turnsUsed !== "number" || d.turnsUsed < 0) return null;
    if (!d.currentQuestion || typeof d.currentQuestion !== "object") return null;
    // A draft saved before "departures" was renamed to "dutyPeriods" would resume a question bound to the old key — start fresh instead.
    if ((d.currentQuestion as { boundTo?: string }).boundTo === "departures") return null;
    return d as InterviewDraft;
  } catch {
    return null;
  }
}

export function loadDraft(userId: string | null, bidPackId: string): InterviewDraft | null {
  if (typeof window === "undefined") return null;
  try {
    return parseDraft(window.localStorage.getItem(draftKey(userId)), bidPackId, Date.now());
  } catch {
    return null;
  }
}

export function saveDraft(userId: string | null, draft: InterviewDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // storage full or unavailable — the interview still works, it just won't be resumable
  }
}

export function clearDraft(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(userId));
    window.localStorage.removeItem(storyDraftKey(userId));
  } catch {
    // ignore
  }
}

/**
 * The bidding story as it's being written — saved on its own, because the
 * full draft above only exists once the questions start, and a story can
 * take minutes to write. A refresh, a locked phone or a switched app
 * shouldn't cost a pilot what they've typed.
 */
function storyDraftKey(userId: string | null): string {
  return `line-select:story-draft:${userId ?? "guest"}:v1`;
}

export function saveStoryDraft(userId: string | null, bidPackId: string, text: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!text.trim()) window.localStorage.removeItem(storyDraftKey(userId));
    else window.localStorage.setItem(storyDraftKey(userId), JSON.stringify({ bidPackId, text, savedAt: Date.now() }));
  } catch {
    // storage full or unavailable — typing still works, it just won't survive a refresh
  }
}

export function loadStoryDraft(userId: string | null, bidPackId: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(storyDraftKey(userId));
    if (!raw) return "";
    const d = JSON.parse(raw) as { bidPackId?: string; text?: string; savedAt?: number };
    const fresh = typeof d.savedAt === "number" && Date.now() - d.savedAt <= DRAFT_MAX_AGE_MS;
    return d.bidPackId === bidPackId && fresh && typeof d.text === "string" ? d.text : "";
  } catch {
    return "";
  }
}
