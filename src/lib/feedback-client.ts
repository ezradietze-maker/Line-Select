import type { FeedbackCategory } from "@/types/feedback";

interface SubmitFeedbackResult {
  ok: boolean;
  error?: string;
}

export async function submitFeedback(input: {
  message: string;
  category: FeedbackCategory;
  page: string;
}): Promise<SubmitFeedbackResult> {
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Something went wrong. Try again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
