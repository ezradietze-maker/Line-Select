import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Compact renders a small slot for a state nested inside a list or
   * panel. The default renders a larger centered treatment for a state
   * that fills the whole screen. */
  compact?: boolean;
  className?: string;
}

/**
 * The default empty-state mark: a radar scope, slowly sweeping — "nothing
 * on the scope yet, still watching" rather than a dead empty tray. The
 * sweep stops under reduced motion.
 */
export function ScopeIcon({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} />
      <circle cx="24" cy="24" r="13.5" fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.2} />
      <circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.2} />
      <path d="M24 3v42M3 24h42" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
      <g className="radar-sweep">
        <path d="M24 24 L24 3 A21 21 0 0 1 41.2 12 Z" fill="url(#scope-sweep)" />
        <path d="M24 24 L24 3" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinecap="round" />
      </g>
      <defs>
        <linearGradient id="scope-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
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
  compact = false,
  className = "",
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className={`animate-fade-in flex flex-col items-center rounded-xl border border-dashed border-hairline bg-canvas/20 px-4 py-7 text-center text-sm text-ink-faint ${className}`}>
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
    <div className={`mx-auto w-full max-w-md animate-fade-in text-center ${className}`}>
      <div className="mb-5 flex justify-center text-ink-faint">{icon ?? <ScopeIcon className="h-16 w-16" />}</div>
      {title && <Heading as="h1" className="text-2xl text-ink sm:text-3xl">{title}</Heading>}
      <p className={`text-sm leading-relaxed text-ink-muted ${title ? "mt-2" : ""}`}>{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-6">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
