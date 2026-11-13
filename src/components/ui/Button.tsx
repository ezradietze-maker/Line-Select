import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  // A direction sign: yellow on navy by day, black on yellow at night.
  // Disabled, it goes grey rather than a faded yellow (which turns olive on navy).
  primary: "bg-brand text-on-brand hover:bg-brand-strong disabled:bg-border-strong disabled:text-ink-faint disabled:hover:bg-border-strong",
  // Quiet: a ruled outline that firms up on hover, so the one sign on the screen stays the one that stands out.
  secondary: "border border-border-strong bg-surface text-ink hover:border-ink disabled:opacity-40 disabled:hover:border-border-strong",
  ghost: "text-ink-muted hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent",
  danger: "bg-danger text-on-danger hover:opacity-90 disabled:opacity-40",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`press inline-flex items-center justify-center gap-2 rounded-[4px] px-4 py-2.5 font-display text-sm font-bold tracking-[0.01em] transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
