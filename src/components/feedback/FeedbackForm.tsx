"use client";

import { useState } from "react";
import { NoteBox } from "@/components/ui/NoteBox";
import { Button } from "@/components/ui/Button";
import { submitFeedback } from "@/lib/feedback-client";
import type { FeedbackCategory } from "@/types/feedback";

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Something’s broken" },
  { value: "idea", label: "I have an idea" },
  { value: "confusing", label: "Something’s confusing" },
  { value: "other", label: "Something else" },
];

interface FeedbackFormProps {
  page: string;
  onClose: () => void;
}

export function FeedbackForm({ page, onClose }: FeedbackFormProps) {
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="py-2 text-center">
        <p className="text-sm text-ink">Thanks — this goes straight to the person building it.</p>
        <Button variant="secondary" className="mt-4" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError("Enter some feedback before sending.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitFeedback({ message: message.trim(), category, page });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setSent(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-ink-muted">
        Bug, idea, or just something that felt off — this is a beta, and this is how it gets better.
      </p>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">What kind of feedback is this?</label>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                category === c.value
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border-strong text-ink-muted hover:border-brand/50 hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="feedback-message" className="mb-1.5 block text-sm font-medium text-ink">
          What&rsquo;s on your mind?
        </label>
        {/* Grows with the message and takes dictation, like every answer box in the app — what's wrong, in their own words. */}
        <NoteBox
          id="feedback-message"
          value={message}
          onChange={setMessage}
          rows={5}
          maxLength={4000}
          placeholder="The more specific, the more useful — what were you doing, what did you expect, what happened instead? (or tap the mic and say it)"
          invalid={!!error}
        />
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}
