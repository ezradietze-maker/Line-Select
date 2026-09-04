interface SpinnerProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export function Spinner({ label, size = "sm", className = "" }: SpinnerProps) {
  const dim = size === "sm" ? "h-4 w-4 border-2" : "h-8 w-8 border-2";
  return (
    <div className={`flex items-center gap-2.5 text-sm text-ink-faint ${className}`}>
      <div className={`${dim} animate-spin rounded-full border-border-strong border-t-brand`} aria-hidden />
      {label && <span>{label}</span>}
    </div>
  );
}
