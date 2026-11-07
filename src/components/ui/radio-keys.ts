import type { KeyboardEvent } from "react";

/**
 * What a button in a `role="radiogroup"` needs to behave like a radio for keyboard users, as screen readers announce
 * it: the group is one Tab stop (the picked option, or the first), and the arrow keys move the pick and the focus
 * along it, wrapping at the ends.
 */
export function radioKeyProps(index: number, count: number, selected: number | null, select: (index: number) => void) {
  return {
    tabIndex: (selected ?? 0) === index ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step || count === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const next = (index + step + count) % count;
      select(next);
      e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    },
  };
}
