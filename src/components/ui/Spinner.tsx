interface SpinnerProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

const LIGHTS = [0, 1, 2, 3, 4];

/**
 * Waiting, drawn as a row of approach lights flashing in turn toward the runway (the rabbit) — the field's own
 * "this way", not a generic ring. Holds still, the first three lit, under reduced motion.
 */
export function Spinner({ label, size = "sm", className = "" }: SpinnerProps) {
  const light = size === "sm" ? "h-[6px] w-[3px]" : "h-3 w-[5px]";
  return (
    // Spans, not divs, so a spinner is valid HTML inside a line of text (a <div> inside a <p> breaks hydration).
    <span className={`flex items-center gap-2.5 text-sm text-ink-faint ${className}`}>
      <span aria-hidden className={`approach-lights flex shrink-0 items-center ${size === "sm" ? "gap-[2px]" : "gap-[3px]"}`}>
        {LIGHTS.map((i) => (
          <span key={i} className={`${light} rounded-[1px] bg-accent`} style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}
