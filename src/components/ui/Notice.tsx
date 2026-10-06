import type { ReactNode } from "react";

type NoticeTone = "warn" | "info" | "note" | "good";

const TONE: Record<NoticeTone, { box: string; led: string }> = {
  warn: { box: "border-warn/35 bg-warn-soft/70 text-warn", led: "bg-warn shadow-[0_0_8px_var(--color-warn)]" },
  info: { box: "border-hairline bg-canvas/50 text-ink-muted", led: "bg-brand" },
  note: { box: "border-hairline bg-transparent text-ink-faint", led: "bg-ink-faint" },
  good: { box: "border-good/35 bg-good-soft/70 text-good", led: "bg-good shadow-[0_0_8px_var(--color-good)]" },
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
 * A standing annunciator: a lit bar down the left edge in the notice's
 * color, the message, and at most one action. Replaces the assorted tinted
 * boxes each screen used to draw for itself.
 */
export function Notice({ tone = "info", children, action, className = "", role }: NoticeProps) {
  const t = TONE[tone];
  return (
    <div role={role} className={`relative flex flex-col gap-3 overflow-hidden rounded-xl border py-3 pl-5 pr-4 text-sm leading-relaxed sm:flex-row sm:items-center sm:justify-between ${t.box} ${className}`}>
      <span aria-hidden className={`absolute inset-y-2.5 left-2 w-[3px] rounded-full ${t.led}`} />
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
