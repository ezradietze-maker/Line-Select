import type { ReactNode } from "react";

interface HeadingProps {
  as?: "h1" | "h2" | "h3" | "h4";
  className?: string;
  children: ReactNode;
}

/**
 * Every heading in the app should opt into the display face (IBM Plex Sans
 * Condensed, via `font-display`) rather than inheriting body text's Public
 * Sans by default — headings and prose read as two different type families
 * on purpose. Size, color, and tracking still vary a lot by context (a hero
 * H1 is not a card's H3), so those stay in `className` at each call site;
 * this only ever standardizes the face and weight.
 */
export function Heading({ as: Tag = "h2", className = "", children }: HeadingProps) {
  return <Tag className={`font-display font-semibold ${className}`}>{children}</Tag>;
}
