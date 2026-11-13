import type { ReactNode } from "react";

type NoticeTone = "warn" | "info" | "note" | "good";

const TONE: Record<NoticeTone, { box: string; led: string }> = {
  // A caution is a sign: black on yellow, the way the field marks a hold short.
  warn: { box: "sign-scheme border-transparent bg-sign text-on-sign", led: "bg-on-sign" },
  info: { box: "border-border bg-panel text-ink-muted", led: "bg-accent" },
  note: { box: "border-border bg-transparent text-ink-faint", led: "bg-ink-faint" },
  good: { box: "border-good/40 bg-good-soft text-good", led: "bg-good" },
};

interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  /** A button or link on the right (below the text on a phone). */
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}

/**
 * A standing notice: a bar down the left edge in the notice's color, the message, and at most one action. A caution
 * is a solid sign. Replaces the assorted tinted boxes each screen used to draw for itself.
 */
export function Notice({ tone = "info", children, action, className = "", role }: NoticeProps) {
  const t = TONE[tone];
  return (
    <div role={role} className={`relative flex flex-col gap-3 overflow-hidden rounded-[4px] border py-3 pl-5 pr-4 text-sm leading-relaxed sm:flex-row sm:items-center sm:justify-between ${t.box} ${className}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${t.led}`} />
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
