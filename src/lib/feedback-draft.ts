import type { FeedbackCategory } from "@/types/feedback";

/**
 * A feedback message half typed when its dialog closed (Escape, a tap outside, the X): kept on this device so opening
 * it again shows what they'd written, and cleared once it's sent. Under the pilot's id when signed in, so signing out
 * on a shared computer takes it with everything else of theirs (`forgetPilotOnDevice`).
 */
export interface FeedbackDraft {
  category: FeedbackCategory;
  message: string;
}

const CATEGORIES: FeedbackCategory[] = ["bug", "idea", "confusing", "other"];
const draftKey = (userId: string | null) => `line-select:feedback-draft:${userId ?? "guest"}:v1`;

export function loadFeedbackDraft(userId: string | null): FeedbackDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(userId));
    const parsed = raw ? (JSON.parse(raw) as Partial<FeedbackDraft>) : null;
    if (!parsed || typeof parsed.message !== "string" || !parsed.message.trim()) return null;
    return { message: parsed.message, category: CATEGORIES.includes(parsed.category as FeedbackCategory) ? (parsed.category as FeedbackCategory) : "idea" };
  } catch {
    return null;
  }
}

/** An empty message clears it: nothing was written to keep. */
export function saveFeedbackDraft(userId: string | null, draft: FeedbackDraft): void {
  if (typeof window === "undefined") return;
  try {
    if (!draft.message.trim()) window.localStorage.removeItem(draftKey(userId));
    else window.localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    // Storage full or unavailable: typing still works, it just isn't kept if the dialog closes.
  }
}

export function clearFeedbackDraft(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(userId));
  } catch {
    // Nothing kept to clear.
  }
}
