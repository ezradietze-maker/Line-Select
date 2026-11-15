"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A changing count as a screen reader hears it: said once it has settled, since every keystroke in a search or a box
 * changes it and reading each one out would talk over the pilot's typing. Nothing is said on arrival, only after a change.
 */
export function useSettledSaying(text: string, ms = 700): string {
  const [said, setSaid] = useState("");
  const last = useRef(text);
  useEffect(() => {
    if (text === last.current) return;
    const timer = window.setTimeout(() => {
      last.current = text;
      setSaid(text);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [text, ms]);
  return said;
}
