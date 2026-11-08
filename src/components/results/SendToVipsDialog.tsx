"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import {
  ANY_LINE_CODES,
  VIPS_BID_REVIEW_URL,
  VIPS_QUESTIONS,
  buildVipsBidFields,
  completeAnswers,
  getVipsAnswers,
  getVipsEmployeeNumber,
  normalizeEmployeeNumber,
  setVipsAnswers,
  setVipsEmployeeNumber,
  vipsBidInputUrl,
  type AnyLineKind,
  type VipsBidDraft,
} from "@/lib/vips-bid";

const ANY_LINE_LABELS: { kind: AnyLineKind; label: string }[] = [
  { kind: "regular", label: "Then any regular line" },
  { kind: "secondary", label: "Then any secondary line" },
  { kind: "reserve", label: "Then any reserve line" },
];

/** How many of the order to show before "and N more" — enough to recognise it's the right bid. */
const PREVIEW_COUNT = 12;

export function SendToVipsDialog({
  lineNumbers,
  packLabel,
  leftOut,
  onClose,
}: {
  /** The order to bid, best first — the same order "Copy line order" copies. */
  lineNumbers: string[];
  /** Month, base, fleet and seat of the pack these lines came from, to check against VIPS's own "You are bidding as…". */
  packLabel: string;
  /** Lines in the pack this order doesn't include (hidden, or outside the current filters) — they won't be bid. */
  leftOut: number;
  onClose: () => void;
}) {
  const [employee, setEmployee] = useState(() => getVipsEmployeeNumber() ?? "");
  const [employeeError, setEmployeeError] = useState<string | undefined>();
  const [answers, setAnswers] = useState<VipsBidDraft>(getVipsAnswers);
  const [anyLines, setAnyLines] = useState<AnyLineKind[]>([]);
  const [sent, setSent] = useState(false);

  const build = useMemo(() => buildVipsBidFields({ lineNumbers, anyLines, answers }), [lineNumbers, anyLines, answers]);
  const normalized = normalizeEmployeeNumber(employee);

  function toggleAnyLine(kind: AnyLineKind) {
    // Kept in the fixed regular → secondary → reserve order whatever order they're ticked in.
    setAnyLines((current) =>
      ANY_LINE_LABELS.map((a) => a.kind).filter((k) => (k === kind ? !current.includes(k) : current.includes(k)))
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!normalized) {
      e.preventDefault();
      setEmployeeError("Your FedEx employee number — digits only.");
      return;
    }
    // Let the browser post the form into its new tab; just remember this month's choices first.
    const complete = completeAnswers(answers);
    if (!complete) {
      e.preventDefault();
      return;
    }
    setVipsEmployeeNumber(normalized);
    setVipsAnswers(complete);
    setSent(true);
  }

  if (sent) {
    return (
      <Modal title="VIPS opened in a new tab" onClose={onClose}>
        <div className="space-y-3 text-sm leading-relaxed text-ink">
          <p>
            Sign in there with your PurpleID to finish. If VIPS shows the bid form empty, nothing reached it &mdash; on an
            iPhone or iPad, turn off Safari&rsquo;s <em>Request Desktop Website</em> for pilot.fedex.com and send again.
          </p>
          <p>
            Then open <strong>Monthly Bid Review</strong> in VIPS and check it lists your {build.ok ? build.lines.length : ""}{" "}
            choices in this order. You can send again any time before the bid closes; the last one VIPS accepts is the
            one that counts.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={VIPS_BID_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-on-brand transition-colors hover:bg-brand-strong"
            >
              Open Monthly Bid Review
            </a>
            <Button variant="secondary" onClick={() => setSent(false)}>
              Back
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Send this bid to VIPS" onClose={onClose}>
      <form
        method="POST"
        action={normalized ? vipsBidInputUrl(normalized) : undefined}
        target="_blank"
        onSubmit={handleSubmit}
        className="space-y-5 text-sm text-ink"
        data-vips-bid-form
      >
        <section>
          <p className="font-medium">
            {packLabel} &middot; {build.ok ? build.lines.length : 0} choices
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Check VIPS says you&rsquo;re bidding this same base, fleet and seat before you submit.
          </p>
          {build.ok && (
            <ol className="mt-2 flex flex-wrap gap-1.5 font-mono text-xs">
              {build.lines.slice(0, PREVIEW_COUNT).map((n, i) => (
                <li key={n} className="rounded border border-hairline bg-canvas px-1.5 py-0.5">
                  <span className="text-ink-faint">{i + 1}.</span> {n}
                </li>
              ))}
              {build.lines.length > PREVIEW_COUNT && (
                <li className="px-1 py-0.5 text-ink-muted">and {build.lines.length - PREVIEW_COUNT} more</li>
              )}
            </ol>
          )}
          {leftOut > 0 && (
            <p className="mt-2 rounded-md bg-warning/15 px-3 py-2 text-xs leading-relaxed">
              {leftOut} {leftOut === 1 ? "line" : "lines"} in the pack {leftOut === 1 ? "isn't" : "aren't"} in this order
              (hidden or filtered out) and won&rsquo;t be bid. If your choices run out, VIPS falls back to your standing bid.
            </p>
          )}
        </section>

        <fieldset>
          <legend className="font-medium">If none of these are left</legend>
          <div className="mt-1.5 space-y-1">
            {ANY_LINE_LABELS.map(({ kind, label }) => (
              <label key={kind} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={anyLines.includes(kind)}
                  onChange={() => toggleAnyLine(kind)}
                  className="h-4 w-4 accent-brand"
                />
                {label} <span className="font-mono text-xs text-ink-faint">({ANY_LINE_CODES[kind]})</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">VIPS&rsquo;s bid questions</legend>
          <p className="text-xs leading-relaxed text-ink-faint">
            Answer each one &mdash; nothing is picked for you. The 2026 contract changes these questions from the
            December 2026 bid, so if VIPS shows different ones, answer them there before you submit.
          </p>
          {VIPS_QUESTIONS.map((q) => (
            <div key={q.key} role="radiogroup" aria-label={q.text} className="flex items-start justify-between gap-4">
              <span className="text-xs leading-relaxed text-ink-muted">{q.text}</span>
              <span className="flex shrink-0 gap-3 pt-0.5">
                {(["Yes", "No"] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name={`vips-${q.key}`}
                      // Owned by no form, so these don't post their own fields to VIPS — the answers go as n003–n006 below.
                      form="vips-not-sent"
                      checked={answers[q.key] === (choice === "Yes")}
                      onChange={() => setAnswers((a) => ({ ...a, [q.key]: choice === "Yes" }))}
                      className="accent-brand"
                    />
                    {choice}
                  </label>
                ))}
              </span>
            </div>
          ))}
        </fieldset>

        <TextField
          label="FedEx employee number"
          inputMode="numeric"
          autoComplete="off"
          value={employee}
          error={employeeError}
          onChange={(e) => {
            setEmployee(e.target.value);
            setEmployeeError(undefined);
          }}
          aria-describedby="vips-employee-note"
        />
        <p id="vips-employee-note" className="-mt-3 text-xs text-ink-faint">
          VIPS needs it in the bid page&rsquo;s address. It stays in this browser and goes only to FedEx.
        </p>

        {build.ok &&
          build.fields.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

        {!build.ok && <p className="text-xs text-danger">{build.reason}</p>}

        <div className="space-y-2 border-t border-border pt-4">
          <Button type="submit" disabled={!build.ok} className="w-full">
            Open VIPS and send
          </Button>
          <p className="text-xs leading-relaxed text-ink-faint">
            Opens pilot.fedex.com in a new tab, where you sign in yourself &mdash; Line Select never sees your password.
            Not made or endorsed by FedEx; VIPS can change without notice, so always check Monthly Bid Review.
          </p>
        </div>
      </form>
    </Modal>
  );
}
