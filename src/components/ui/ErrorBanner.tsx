import type { ReactNode } from "react";

interface ErrorBannerProps {
  children: ReactNode;
  className?: string;
}

/** An error, read out by a screen reader the moment it appears (role="alert" is assertive), not left for it to find. */
export function ErrorBanner({ children, className = "" }: ErrorBannerProps) {
  return (
    <div role="alert" className={`rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger ${className}`}>
      {children}
    </div>
  );
}
