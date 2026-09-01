"use client";

import { useState } from "react";
import { classifyFreeText, submitCandidateVariable } from "@/lib/preference-classifier";

export interface FollowUpMatch {
  variableId: string;
  direction: 1 | -1;
}

interface AdaptiveFollowUpProps {
  /** Plain-language framing for the classifier — the question and which way the pilot leaned, not a specific trip pair, since this is a standalone slider answer rather than a drag-and-drop correction. */
  context: string;
  onResolved: (match: FollowUpMatch | null) => void;
}

/**
 * Shown only when a slider lands at an extreme — asks, once, in the
 * pilot's own words, what's actually driving that. Purely optional: doing
 * nothing and clicking "Next" is a fully valid answer. Reuses the same
 * classify-preference pipeline (and the same sensitive-category guardrail)
 * already proven in the drag-and-drop correction flow, just with a
 * standalone-preference framing instead of a trip-pair comparison.
 */
export function AdaptiveFollowUp({ context, onResolved }: AdaptiveFollowUpProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    const result = await classifyFreeText({ freeText: trimmed, context });
    setBusy(false);

    if (result?.matchedVariableId) {
      setThanks("Got it — factored that in.");
      onResolved({ variableId: result.matchedVariableId, direction: result.direction === "favors_less" ? -1 : 1 });
      return;
    }

    if (result?.proposedName) {
      await submitCandidateVariable({
        rawQuote: trimmed,
        proposedName: result.proposedName,
        proposedDescription: result.proposedDescription ?? "",
        favoredLineNumber: "",
        overtakenLineNumber: "",
      });
      setThanks("Got it — that's not something I'm tracking yet, but I've made a note of it.");
      onResolved(null);
      return;
    }

    // Classification unavailable/failed — still keep the pilot's words rather than silently drop them.
    await submitCandidateVariable({
      rawQuote: trimmed,
      proposedName: "Unclassified note",
      proposedDescription: "",
      favoredLineNumber: "",
      overtakenLineNumber: "",
    });
    setThanks("Noted, thanks.");
    onResolved(null);
  }

  if (thanks) {
    return <p className="mt-4 animate-fade-in text-sm text-ink-muted">{thanks}</p>;
  }

  return (
    <div className="mt-4 animate-fade-in rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
      <p className="text-xs font-medium text-ink">
        That&rsquo;s a strong lean &mdash; want to say why, in your own words? Totally optional.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="e.g. I've got two kids under 5 at home"
          className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Send"}
        </button>
      </div>
    </div>
  );
}
