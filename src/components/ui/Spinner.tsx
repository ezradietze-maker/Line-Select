interface SpinnerProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Waiting, drawn as an attitude indicator: the horizon rocking gently through a bank behind fixed little wings — an
 * instrument a pilot reads at a glance, not a generic ring. Holds a slight bank, still, under reduced motion.
 */
export function Spinner({ label, size = "sm", className = "" }: SpinnerProps) {
  const dim = size === "sm" ? "h-4 w-4" : "h-8 w-8";
  return (
    // Spans, not divs, so a spinner is valid HTML inside a line of text (a <div> inside a <p> breaks hydration).
    <span className={`flex items-center gap-2.5 text-sm text-ink-faint ${className}`}>
      <svg viewBox="-12 -12 24 24" className={`${dim} shrink-0`} aria-hidden>
        <circle r={11} fill="var(--color-canvas)" />
        {/* The ground half, turning about the centre: a half-disc stays inside the dial at any bank. */}
        <g className="attitude-roll">
          <path d="M-11 0 A11 11 0 0 0 11 0 Z" fill="var(--color-accent)" opacity={0.55} />
          <line x1={-11} y1={0} x2={11} y2={0} stroke="var(--color-ink-muted)" strokeWidth={1.2} />
        </g>
        <circle r={11} fill="none" stroke="var(--color-border-strong)" strokeWidth={2} />
        {/* The aircraft symbol, fixed. */}
        <path d="M-7 0 H-2.5 L0 2.2 L2.5 0 H7" fill="none" stroke="var(--color-ink)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
}
