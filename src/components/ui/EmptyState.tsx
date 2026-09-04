import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Compact renders a small dashed-border box for a state nested inside a
   * list or panel. The default renders a larger centered treatment for a
   * state that fills the whole screen. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
  className = "",
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className={`animate-fade-in rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-ink-faint ${className}`}>
        {icon && <div className="mb-2 flex justify-center">{icon}</div>}
        {title && <div className="font-medium text-ink-muted">{title}</div>}
        <div className={title ? "mt-1" : ""}>{description}</div>
        {actionLabel && onAction && (
          <Button variant="secondary" onClick={onAction} className="mt-4">
            {actionLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full max-w-md animate-fade-in text-center ${className}`}>
      {icon && <div className="mb-4 flex justify-center text-ink-faint">{icon}</div>}
      {title && <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>}
      <p className={`text-sm leading-relaxed text-ink-muted ${title ? "mt-2" : ""}`}>{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-6">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
