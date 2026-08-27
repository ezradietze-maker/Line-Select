"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  classifyFreeText,
  submitCandidateVariable,
} from "@/lib/preference-classifier";
import {
  reinforceVariable,
  topJudgmentFactors,
  type PairwiseJudgment,
} from "@/lib/rank-learning";
import type { LineScore } from "@/lib/scoring";
import type { PreferenceProfile } from "@/types/preferences";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function lineSummary(line: LineScore): string {
  const l = line.line;
  return `Line ${l.lineNumber}: ${l.trips.length} trip${l.trips.length !== 1 ? "s" : ""}, ${l.daysOff} days off, ${formatHours(l.totalCreditHours)} credit, ${formatHours(l.totalTafbHours)} TAFB`;
}

interface PreferenceMicroPromptProps {
  judgment: PairwiseJudgment;
  profile: PreferenceProfile;
  implicitValuesByLine: Record<string, Record<string, number>>;
  onResolved: (updatedProfile: PreferenceProfile | null) => void;
}

/**
 * The clarifying micro-prompt from Section 5.3 — only shown when a drag
 * genuinely surprised the model. Every path out of it is one tap: pick a
 * chip, skip, or (optionally) type a sentence. Nothing here blocks the
 * drag-and-drop interaction itself, which has already happened and already
 * updated the model by the time this renders.
 */
export function PreferenceMicroPrompt({
  judgment,
  profile,
  implicitValuesByLine,
  onResolved,
}: PreferenceMicroPromptProps) {
  const [showFreeText, setShowFreeText] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanksMessage, setThanksMessage] = useState<string | null>(null);

  const factors = topJudgmentFactors(judgment, profile, implicitValuesByLine, 5);

  function handleChip(factorId: string, direction: 1 | -1) {
    onResolved(reinforceVariable(profile, factorId, direction));
  }

  async function handleFreeTextSubmit() {
    const text = freeText.trim();
    if (!text) return;
    setBusy(true);
    const favoredSummary = lineSummary(judgment.favored);
    const overtakenSummary = lineSummary(judgment.overtaken);
    const result = await classifyFreeText({ freeText: text, favoredSummary, overtakenSummary });
    setBusy(false);

    if (result?.matchedVariableId) {
      onResolved(reinforceVariable(profile, result.matchedVariableId, result.direction === "favors_less" ? -1 : 1));
      return;
    }

    if (result?.proposedName) {
      await submitCandidateVariable({
        rawQuote: text,
        proposedName: result.proposedName,
        proposedDescription: result.proposedDescription ?? "",
        favoredLineNumber: judgment.favored.line.lineNumber,
        overtakenLineNumber: judgment.overtaken.line.lineNumber,
      });
      setThanksMessage("Got it — that's not something I'm tracking yet, but I've made a note of it.");
      setTimeout(() => onResolved(profile), 1800);
      return;
    }

    // Classification service unavailable/failed — still keep the pilot's words rather than silently drop them.
    await submitCandidateVariable({
      rawQuote: text,
      proposedName: "Unclassified note",
      proposedDescription: "",
      favoredLineNumber: judgment.favored.line.lineNumber,
      overtakenLineNumber: judgment.overtaken.line.lineNumber,
    });
    setThanksMessage("Noted, thanks.");
    setTimeout(() => onResolved(profile), 1800);
  }

  return (
    <Modal title="What made this one better for you?" onClose={() => onResolved(null)}>
      <div className="grid gap-1.5 text-xs text-ink-muted sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <div className="font-medium text-ink">{lineSummary(judgment.favored)}</div>
          <div className="mt-0.5 text-ink-faint">You ranked this one higher</div>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <div className="font-medium text-ink">{lineSummary(judgment.overtaken)}</div>
          <div className="mt-0.5 text-ink-faint">Than this one</div>
        </div>
      </div>

      {thanksMessage ? (
        <p className="mt-3 text-sm text-ink">{thanksMessage}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {factors.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => handleChip(f.id, f.direction)}
                disabled={busy}
                className="rounded-full border border-accent/40 bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-accent-soft disabled:opacity-50"
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowFreeText((v) => !v)}
              disabled={busy}
              className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Something else
            </button>
          </div>

          {showFreeText && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. I hate layovers under 10 hours"
                className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <Button onClick={handleFreeTextSubmit} disabled={busy || !freeText.trim()}>
                {busy ? "Thinking…" : "Send"}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
