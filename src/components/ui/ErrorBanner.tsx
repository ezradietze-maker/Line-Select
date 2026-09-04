import type { ReactNode } from "react";

interface ErrorBannerProps {
  children: ReactNode;
  className?: string;
}

export function ErrorBanner({ children, className = "" }: ErrorBannerProps) {
  return (
    <div className={`rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger ${className}`}>
      {children}
    </div>
  );
}
