"use client";

import { useState } from "react";
import { requestSwapReason } from "@/lib/brain/client";
import type { SwapReply } from "@/lib/brain/profile-model";
import { optionFromReason, type FactorOption, type SwapQuestion } from "@/lib/brain/swap-question";
import type { ReasonOption } from "@/lib/brain/swap-reason";

interface Props {
  question: SwapQuestion;
  /** What a typed reason can be matched to, with both lines' values. */
  options: { priorities: ReasonOption[]; measures: ReasonOption[] };
  onReply: (reply: SwapReply) => void;
  onDismiss: () => void;
  onStop: () => void;
}

const chip =
  "rounded-[3px] border border-border bg-surface px-3 py-1.5 text-left text-sm text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
const quiet = "text-sm font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline";

/**
 * The one question after an unclear swap (`lib/brain/swap-question.ts`): the real differences to pick from, nothing
 * chosen for the pilot, and every way out a single tap. Sits under the swap's message — never in the way of the list.
 */
export function SwapQuestionCard({ question, options, onReply, onDismiss, onStop }: Props) {
  const [mode, setMode] = useState<"choose" | "type" | "confirm">("choose");
  const [adding, setAdding] = useState<{ option: FactorOption; text?: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function pick(option: FactorOption, said?: string) {
    // A measure they never named becomes a new priority only if they say so.
    if (!option.criterionId) {
      setAdding({ option, text: said });
      setMode("confirm");
      return;
    }
    onReply({ kind: "factor", option, ...(said ? { text: said } : {}) });
  }

  async function send() {
    const said = text.trim();
    if (!said) return;
    setBusy(true);
    setNote(null);
    try {
      const reason = await requestSwapReason({ text: said, higher: question.higher, lower: question.lower, ...options });
      if (reason.kind === "notMeasurable") return onReply({ kind: "note", text: said });
      if (reason.kind === "unclear") return setNote("I couldn't tell what that points to — try saying which part of the lines, or pick one above.");
      const { option, same } = optionFromReason(reason, options);
      if (same) return setNote(`Both lines have the same ${same.label.toLowerCase()} (${same.higher}) — was it something else?`);
      if (option) pick(option, said);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't read that just now.");
    } finally {
      setBusy(false);
    }
  }

  const heading =
    question.kind === "limit"
      ? `Line ${question.higher} breaks your limit on ${question.label.toLowerCase()} (${question.amounts}). Should that still put it at the bottom of your list?`
      : `Why does line ${question.higher} beat ${question.lower} for you?`;

  return (
    <section aria-label="Why did you swap these lines?" className="mt-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 animate-fade-in print:hidden">
      <p className="text-sm font-semibold text-ink">{heading}</p>

      {mode === "confirm" && adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">
            Add &ldquo;{adding.option.label}&rdquo; ({adding.option.amounts}) to your priorities? It starts small, and your swaps can raise it.
          </span>
          <button type="button" className={chip} onClick={() => onReply({ kind: "factor", option: adding.option, ...(adding.text ? { text: adding.text } : {}) })}>
            Add it
          </button>
          <button type="button" className={quiet} onClick={onDismiss}>
            Not now
          </button>
        </div>
      ) : question.kind === "limit" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={chip} onClick={() => onReply({ kind: "limit", action: "keep" })}>
            Yes, keep it
          </button>
          <button type="button" className={chip} onClick={() => onReply({ kind: "limit", action: "drop" })}>
            No, it doesn&rsquo;t have to
          </button>
          <button type="button" className={chip} onClick={() => onReply({ kind: "limit", action: "raise" })}>
            {question.op === "max" ? "Raise" : "Lower"} it to {Number.isInteger(question.value) ? question.value : Math.round(question.value * 10) / 10}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {question.options.map((o) => (
            <button key={o.criterionId ?? o.metric} type="button" className={chip} onClick={() => pick(o)}>
              {o.label} ({o.amounts}){o.criterionId ? "" : " · new"}
            </button>
          ))}
          <button type="button" className={chip} onClick={() => setMode("type")} aria-expanded={mode === "type"}>
            Something else&hellip;
          </button>
          <button type="button" className={chip} onClick={() => onReply({ kind: "equal" })}>
            About equal
          </button>
        </div>
      )}

      {mode === "type" && (
        <form
          className="mt-2 flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            type="text"
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            placeholder="In a few words — e.g. “the Honolulu layover”"
            aria-label="Why, in your words"
            className="min-w-0 flex-1 rounded-md border border-field-edge bg-surface px-3 py-1.5 text-sm text-ink"
            autoFocus
          />
          <button type="submit" className={chip} disabled={busy || !text.trim()}>
            {busy ? "Reading…" : "Send"}
          </button>
        </form>
      )}

      {note && (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          {note}
        </p>
      )}

      <div className="mt-2 flex gap-4">
        <button type="button" className={quiet} onClick={onDismiss}>
          Not sure
        </button>
        <button type="button" className={quiet} onClick={onStop}>
          Stop asking
        </button>
      </div>
    </section>
  );
}
