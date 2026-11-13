import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** A quieter second way forward, shown as a link under the main action. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Compact renders a small slot for a state nested inside a list or
   * panel. The default renders a larger centered treatment for a state
   * that fills the whole screen. */
  compact?: boolean;
  className?: string;
}

/**
 * The default empty-state mark: a still radar scope — "nothing on the scope yet" rather than a dead empty tray. Its
 * rings draw once as it appears (Draw), then it holds still; drawn whole under reduced motion.
 */
export function ScopeIcon({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle className="route-draw" pathLength={1} cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} />
      <circle className="route-draw" pathLength={1} cx="24" cy="24" r="13.5" fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.2} />
      <circle className="route-draw" pathLength={1} cx="24" cy="24" r="6" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.2} />
      <path d="M24 3v42M3 24h42" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
      {/* The sweep's line, at rest. */}
      <path d="M24 24 L24 3" stroke="var(--color-accent)" strokeWidth={1.5} />
      <circle cx="24" cy="24" r="1.8" fill="var(--color-accent)" />
    </svg>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
  className = "",
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className={`animate-fade-in flex flex-col items-center rounded-[6px] border border-dashed border-border-strong px-4 py-7 text-center text-sm text-ink-faint ${className}`}>
        <div className="mb-3 text-ink-faint">{icon ?? <ScopeIcon className="h-9 w-9" />}</div>
        {title && <div className="font-medium text-ink-muted">{title}</div>}
        <div className={`max-w-sm ${title ? "mt-1" : ""}`}>{description}</div>
        {actionLabel && onAction && (
          <Button variant="secondary" onClick={onAction} className="mt-4">
            {actionLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full max-w-md text-center ${className}`}>
      <div className="mb-5 flex justify-center text-ink-faint">{icon ?? <ScopeIcon className="h-16 w-16" />}</div>
      {title && <Heading as="h1" className="text-balance text-2xl text-ink sm:text-3xl">{title}</Heading>}
      <p className={`text-pretty text-sm leading-relaxed text-ink-muted ${title ? "mt-2" : ""}`}>{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-6">
          {actionLabel}
        </Button>
      )}
      {secondaryLabel && onSecondary && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onSecondary}
            className="text-sm text-ink-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-ink"
          >
            {secondaryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
