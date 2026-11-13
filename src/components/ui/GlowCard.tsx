import type { HTMLAttributes, ReactNode } from "react";

interface GlowCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** A sign edge around the card — reserved for the one thing on a screen that matters most. */
  glow?: boolean;
  /** Lifts slightly on hover, for cards that open or select something. */
  interactive?: boolean;
}

/**
 * The base surface: a plain panel (`.panel-glass` — a flat face, a crisp border, a small shadow), optionally marked
 * with a sign edge. Purely presentational; all layout and padding stay with the caller.
 */
export function GlowCard({ children, glow = false, interactive = false, className = "", ...rest }: GlowCardProps) {
  return (
    <div
      {...rest}
      className={`panel-glass ${glow ? "glow-soft" : ""} ${interactive ? "hover-lift" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
