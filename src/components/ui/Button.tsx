import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong disabled:opacity-40 disabled:hover:bg-brand",
  secondary:
    "bg-surface border border-border-strong text-ink hover:border-brand hover:text-brand disabled:opacity-40",
  ghost: "text-ink-muted hover:text-ink disabled:opacity-40",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
