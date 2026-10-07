interface SpinnerProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export function Spinner({ label, size = "sm", className = "" }: SpinnerProps) {
  const dim = size === "sm" ? "h-4 w-4 border-2" : "h-8 w-8 border-2";
  return (
    // Spans, not divs, so a spinner is valid HTML inside a line of text (a <div> inside a <p> breaks hydration).
    <span className={`flex items-center gap-2.5 text-sm text-ink-faint ${className}`}>
      <span className={`${dim} inline-block shrink-0 animate-spin rounded-full border-border-strong border-t-brand`} aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}
