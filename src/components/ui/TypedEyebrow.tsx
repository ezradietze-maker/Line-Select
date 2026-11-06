"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";

const SEEN = "line-select:typed-eyebrow:";

/**
 * A page's context line ("MEM · MD11 · CAP · OCT26") typing itself out like a cockpit data readout — the first time
 * the page is opened in a visit, then simply there. Decided before the first paint, so it never flashes in whole and
 * then retypes; skipped under reduced motion.
 */
export function TypedEyebrow({ text }: { text: string }) {
  const path = usePathname();
  const [typing, setTyping] = useState(false);
  useLayoutEffect(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.sessionStorage.getItem(SEEN + path)) return;
      window.sessionStorage.setItem(SEEN + path, "1");
    } catch {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, before paint, from session storage
    setTyping(true);
  }, [path]);
  if (!typing) return <>{text}</>;
  return (
    <span>
      <span className="sr-only">{text}</span>
      {[...text].map((ch, i) => (
        <span key={i} aria-hidden className="type-in" style={{ animationDelay: `${i * 26}ms` }}>
          {ch}
        </span>
      ))}
      <span aria-hidden className="type-caret" style={{ animationDelay: `${text.length * 26}ms` }} />
    </span>
  );
}
