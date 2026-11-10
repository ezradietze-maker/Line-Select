"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";

const SEEN = "line-select:typed-eyebrow:";

/**
 * A page's context line ("MEM · MD11 · CAP · OCT26") typing itself out like a cockpit data readout — the first time
 * the page is opened in a visit, then simply there. Hidden until that's decided, before the browser paints a page built
 * in the browser and at hydration for one built on the server, so it never flashes in whole and then retypes; skipped
 * under reduced motion.
 */
export function TypedEyebrow({ text }: { text: string }) {
  const path = usePathname();
  const [how, setHow] = useState<"undecided" | "plain" | "typing">("undecided");
  useLayoutEffect(() => {
    let type = false;
    try {
      type = !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !window.sessionStorage.getItem(SEEN + path);
      if (type) window.sessionStorage.setItem(SEEN + path, "1");
    } catch {
      type = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, before paint, from session storage
    setHow((now) => (now === "typing" ? now : type ? "typing" : "plain"));
  }, [path]);
  if (how === "undecided") return <span className="invisible">{text}</span>;
  if (how === "plain") return <>{text}</>;
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
