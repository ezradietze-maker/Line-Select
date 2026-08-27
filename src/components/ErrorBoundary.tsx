"use client";

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered in place of `children` once something inside has thrown. Defaults to a minimal inline notice sized for a single card, not a full-page takeover — see app/error.tsx for that. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * A real React error boundary — there's still no hook equivalent, this has
 * to be a class component. Scoped narrowly (e.g. around one line card in a
 * list of ~100) rather than wrapped around the whole app, so a bug
 * triggered by one specific line's data doesn't take out every other line
 * along with it. `app/error.tsx` is the page-level fallback for anything
 * that isn't caught by a boundary like this one.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            This one couldn&rsquo;t be displayed. The rest of your rankings are unaffected.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
