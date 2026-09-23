"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface RecoveryCodePanelProps {
  code: string;
  /** Why it's being shown — changes only the opening line. */
  reason: "signup" | "reset" | "new";
  onDone: () => void;
  doneLabel?: string;
}

const INTRO: Record<RecoveryCodePanelProps["reason"], string> = {
  signup: "Your account is ready. One more thing before you start:",
  reset: "Your password is changed and you're signed in. Your old recovery code no longer works — here's your new one:",
  new: "Here's your new recovery code. Any earlier one no longer works:",
};

/**
 * There's no email reset — this code is the only way back into an account
 * whose password is forgotten, so it's shown exactly once and the pilot has
 * to say they've kept it before moving on. Deliberately can't be dismissed
 * by accident: the only exit is the confirmed button.
 */
export function RecoveryCodePanel({ code, reason, onDone, doneLabel = "Continue" }: RecoveryCodePanelProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the code is right there on screen to write down
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-muted">{INTRO[reason]}</p>
      <h2 className="mt-3 text-lg font-semibold text-ink">Save your recovery code</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        If you ever forget your password, this code is the <strong className="text-ink">only</strong> way back into your
        account &mdash; there&rsquo;s no email reset. It&rsquo;s shown once. Write it down or keep it in your password
        manager.
      </p>

      <div
        className="mt-4 select-all rounded-lg border border-border-strong bg-canvas px-4 py-4 text-center font-mono text-xl font-semibold tracking-wider text-ink"
        aria-label="Your recovery code"
      >
        {code}
      </div>

      <div className="mt-3 flex justify-center">
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy code"}
        </Button>
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong text-brand focus:ring-brand"
        />
        <span>I&rsquo;ve saved this somewhere I can find it later.</span>
      </label>

      <Button onClick={onDone} disabled={!saved} className="mt-5 w-full">
        {doneLabel}
      </Button>
    </div>
  );
}
