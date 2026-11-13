import type { ReactNode } from "react";

interface ErrorBannerProps {
  children: ReactNode;
  className?: string;
}

/** An error, read out by a screen reader the moment it appears (role="alert" is assertive), not left for it to find. */
export function ErrorBanner({ children, className = "" }: ErrorBannerProps) {
  return (
    <div role="alert" className={`relative overflow-hidden rounded-[4px] border border-danger/40 bg-danger-soft py-3 pl-5 pr-4 text-sm text-danger ${className}`}>
      {/* Red is kept for stop: a solid bar down the edge, as on every notice. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-danger" />
      {children}
    </div>
  );
}
