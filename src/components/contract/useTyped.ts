"use client";

import { useEffect, useRef, useState } from "react";

const TICK_MS = 20;

/**
 * Text typed out over about `totalMs`, however long it is. Only for words that are final: this page never types anything
 * that hasn't been checked. Calls `onDone` when it's all showing, straight away when `instant` (a turn restored from
 * this device, or a pilot who's asked for less motion).
 */
export function useTyped(text: string, { totalMs, instant, onDone }: { totalMs: number; instant: boolean; onDone?: () => void }): string {
  const [count, setCount] = useState(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (instant) return;
    const step = Math.max(1, Math.ceil(text.length / (totalMs / TICK_MS)));
    const timer = setInterval(() => setCount((c) => Math.min(text.length, c + step)), TICK_MS);
    return () => clearInterval(timer);
  }, [text, totalMs, instant]);

  const finished = instant || count >= text.length;
  useEffect(() => {
    if (finished) done.current?.();
  }, [finished]);

  return instant ? text : text.slice(0, count);
}

export function prefersLessMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
